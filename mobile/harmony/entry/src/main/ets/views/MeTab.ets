import { common } from '@kit.AbilityKit';
import { AppConfig, RouteParam, Routes } from '../common/Config';
import { Fmt } from '../common/Format';
import { Appearance } from '../api/Appearance';
import { Cache } from '../api/Cache';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { QueueCustomer } from '../api/Models';
import { LvIcon } from '../components/LvIcon';

const MODES: string[] = ['system', 'light', 'dark'];
const MODE_NAMES: string[] = ['跟随系统', '浅色', '深色'];

function sizeText(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 我的: account, 数据分析, 账号与安全 (修改密码, 退出其他设备), 外观, 离线数据, 检查更新, sign out —
 * the prototype's 我的 page (prototypes/mobile-app/js/screens/me.js) on the real BOS.
 */
@Component
export struct MeTab {
  @Consume('pathStack') pathStack: NavPathStack;
  @StorageProp('userName') userName: string = '';
  @StorageProp('userRole') userRole: string = '';
  @StorageProp('userEmail') userEmail: string = '';
  @State busy: boolean = false;
  @State sheet: string = '';
  @State showSheet: boolean = false;
  // 修改密码
  @State currentPassword: string = '';
  @State newPassword: string = '';
  @State confirmPassword: string = '';
  @State passwordError: string = '';
  @State saving: boolean = false;
  // 外观 / 离线数据 / 检查更新
  @State mode: string = Appearance.mode;
  @State cacheText: string = '';
  @State syncNote: string = '';
  @State checking: boolean = false;

  aboutToAppear(): void {
    this.refreshCache();
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2200 });
  }

  private refreshCache(): void {
    const stats = Cache.stats();
    this.cacheText = stats.files > 0 ? `${stats.files} 项 · ${sizeText(stats.bytes)}` : '还没有';
  }

  private open(kind: string): void {
    this.sheet = kind;
    this.passwordError = '';
    this.syncNote = '';
    this.refreshCache();
    this.showSheet = true;
  }

  private confirmLogout(): void {
    this.getUIContext().showAlertDialog({
      title: '退出登录？',
      message: '退出后需要重新输入邮箱和密码，这台手机上保存的离线数据会一起清除。',
      autoCancel: true,
      alignment: DialogAlignment.Center,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: {
        value: '退出登录',
        fontColor: $r('app.color.danger'),
        action: () => {
          this.logout();
        }
      }
    });
  }

  private async logout(): Promise<void> {
    this.busy = true;
    try {
      await Repo.logout();
    } catch (e) {
      // The local session is cleared either way (Repo.logout finally).
      console.warn(`logout: ${Api.message(e)}`);
    } finally {
      this.busy = false;
    }
  }

  private async savePassword(): Promise<void> {
    if (this.currentPassword.length === 0) {
      this.passwordError = '请填写当前密码';
      return;
    }
    if (this.newPassword.length < 8) {
      this.passwordError = '新密码至少 8 位';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.passwordError = '两次输入的新密码不一致';
      return;
    }
    this.saving = true;
    this.passwordError = '';
    try {
      await Repo.changePassword(this.currentPassword, this.newPassword);
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';
      this.showSheet = false;
      this.toast('密码已修改。其他设备需要用新密码重新登录');
    } catch (e) {
      this.passwordError = Api.message(e);
    } finally {
      this.saving = false;
    }
  }

  private confirmSignOutOthers(): void {
    this.getUIContext().showAlertDialog({
      title: '退出其他设备？',
      message: '电脑和其他手机上的登录会立即失效，需要重新登录；这台手机保持登录。',
      autoCancel: true,
      alignment: DialogAlignment.Center,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: {
        value: '退出其他设备',
        fontColor: $r('app.color.danger'),
        action: () => {
          this.signOutOthers();
        }
      }
    });
  }

  private async signOutOthers(): Promise<void> {
    try {
      await Repo.signOutOtherDevices();
      this.toast('其他设备已退出登录');
    } catch (e) {
      this.toast(Api.message(e));
    }
  }

  private async setMode(mode: string): Promise<void> {
    this.mode = mode;
    await Appearance.set(mode);
  }

  /** 立即同步: the lists and the customers most likely needed today, so they open without a network. */
  private async syncNow(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.syncNote = '正在下载工作台、队列和订单';
      await Repo.notifications();
      await Repo.queue('today', '', 1);
      await Repo.queue('new', '', 1);
      await Repo.queue('waiting', '', 1);
      await Repo.queue('recent', '', 1);
      await Repo.orders('ALL', '', 1);
      await Repo.todayTasks();
      await Repo.overdueTasks();
      await Repo.performance();
      const ids: string[] = [];
      const lists = ['today', 'waiting', 'new', 'recent'];
      for (let i = 0; i < lists.length; i++) {
        const queue = Repo.peekQueue(lists[i]);
        if (queue !== null) {
          queue.customers.forEach((c: QueueCustomer) => {
            if (ids.indexOf(c.id) < 0 && ids.length < 60) {
              ids.push(c.id);
            }
          });
        }
      }
      for (let i = 0; i < ids.length; i++) {
        this.syncNote = `正在下载客户资料 ${i + 1} / ${ids.length}`;
        try {
          await Repo.customer(ids[i]);
        } catch (e) {
          // One customer failing does not stop the rest.
        }
      }
      this.syncNote = `已同步，最近的 ${ids.length} 位客户没网时也能打开`;
    } catch (e) {
      this.syncNote = `同步没有完成：${Api.message(e)}`;
    } finally {
      this.busy = false;
      this.refreshCache();
    }
  }

  private clearCache(): void {
    Cache.clear();
    this.refreshCache();
    this.toast('已清除这台手机上的离线数据');
  }

  private async checkUpdate(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const v = await Repo.appVersion();
      const latest = v.latest;
      if (latest === null || latest.versionCode <= AppConfig.VERSION_CODE) {
        this.toast(`已是最新版本 ${AppConfig.VERSION}`);
        return;
      }
      const url = latest.url;
      this.getUIContext().showAlertDialog({
        title: `发现新版本 ${latest.versionName}`,
        message: latest.notes.length > 0 ? latest.notes : '有新的内部版本可以安装。',
        autoCancel: true,
        alignment: DialogAlignment.Center,
        primaryButton: { value: '稍后', action: () => {} },
        secondaryButton: {
          value: '去下载',
          action: () => {
            this.openLink(url);
          }
        }
      });
    } catch (e) {
      this.toast(Api.message(e));
    } finally {
      this.checking = false;
    }
  }

  private openLink(url: string): void {
    const context = this.getUIContext().getHostContext();
    if (context === undefined) return;
    (context as common.UIAbilityContext).openLink(url).catch(() => {
      this.toast('无法打开下载页面');
    });
  }

  /** '@mode' / '@cache' / '@update' are read from state here, so the rows follow changes (builder values would not). */
  private cellValue(value: string): string {
    if (value === '@mode') return MODE_NAMES[Math.max(0, MODES.indexOf(this.mode))];
    if (value === '@cache') return this.cacheText;
    if (value === '@update') return this.checking ? '正在检查' : `当前 ${AppConfig.VERSION}`;
    return value;
  }

  @Builder
  cell(icon: string, title: string, value: string, action: () => void) {
    Row({ space: 12 }) {
      Row() {
        LvIcon({ name: icon, iconColor: $r('app.color.brand_ink'), iconSize: 19 })
      }
      .width(34).height(34).borderRadius(10).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.brand_tint'))
      Text(title).fontSize(15).fontColor($r('app.color.ink')).layoutWeight(1)
      Text(this.cellValue(value)).fontSize(13).fontColor($r('app.color.ink3')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      LvIcon({ name: 'chevron-right', iconColor: $r('app.color.ink3'), iconSize: 18 })
    }
    .width('100%')
    .height(56)
    .padding({ left: 16, right: 16 })
    .onClick(() => action())
  }

  @Builder
  group(title: string) {
    Text(title).fontSize(13).fontColor($r('app.color.ink3')).width('100%').padding({ left: 4, top: 4 })
  }

  @Builder
  passwordSheet() {
    Column({ space: 14 }) {
      Text('修改密码').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
      TextInput({ placeholder: '当前密码', text: this.currentPassword })
        .type(InputType.Password).height(48).fontSize(16).backgroundColor($r('app.color.surface2'))
        .onChange((v: string) => {
          this.currentPassword = v;
        })
      TextInput({ placeholder: '新密码（至少 8 位）', text: this.newPassword })
        .type(InputType.Password).height(48).fontSize(16).backgroundColor($r('app.color.surface2'))
        .onChange((v: string) => {
          this.newPassword = v;
        })
      TextInput({ placeholder: '再输入一次新密码', text: this.confirmPassword })
        .type(InputType.Password).height(48).fontSize(16).backgroundColor($r('app.color.surface2'))
        .onChange((v: string) => {
          this.confirmPassword = v;
        })
      if (this.passwordError.length > 0) {
        Text(this.passwordError).fontSize(13).fontColor($r('app.color.danger'))
      }
      Text('改完后这台手机保持登录，电脑和其他手机需要用新密码重新登录。').fontSize(12).fontColor($r('app.color.ink3'))
      Button(this.saving ? '正在保存' : '保存新密码')
        .type(ButtonType.Normal).width('100%').height(48).borderRadius(12)
        .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
        .enabled(!this.saving)
        .onClick(() => {
          this.savePassword();
        })
    }
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 8, bottom: 24 })
  }

  @Builder
  appearanceSheet() {
    Column({ space: 10 }) {
      Text('外观').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
      ForEach(MODES, (mode: string, index: number) => {
        Row() {
          Text(MODE_NAMES[index]).fontSize(16).fontColor($r('app.color.ink')).layoutWeight(1)
          if (this.mode === mode) {
            LvIcon({ name: 'check', iconColor: $r('app.color.brand_ink'), iconSize: 20 })
          }
        }
        .width('100%')
        .height(52)
        .padding({ left: 14, right: 14 })
        .borderRadius(12)
        .backgroundColor(this.mode === mode ? $r('app.color.brand_tint') : $r('app.color.surface2'))
        .onClick(() => {
          this.setMode(mode);
        })
      }, (mode: string): string => mode)
      Text('字号跟随手机「设置 → 显示和亮度 → 字体大小」。').fontSize(12).fontColor($r('app.color.ink3'))
    }
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 8, bottom: 24 })
  }

  @Builder
  offlineSheet() {
    Column({ space: 12 }) {
      Text('离线数据').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
      Text(`这台手机上保存了：${this.cacheText}`).fontSize(15).fontColor($r('app.color.ink'))
      Text('打开过的工作台、客户、订单和对话会自动保存，没有网络时也能查看（不能修改）。「立即同步」会再下载今天最可能用到的约 60 位客户。退出登录时自动清除。')
        .fontSize(13).fontColor($r('app.color.ink2')).lineHeight(20)
      if (this.syncNote.length > 0) {
        Text(this.syncNote).fontSize(13).fontColor($r('app.color.brand_ink'))
      }
      Row({ space: 10 }) {
        Button('清除')
          .type(ButtonType.Normal).height(46).borderRadius(12).layoutWeight(1)
          .fontColor($r('app.color.danger')).backgroundColor($r('app.color.surface2'))
          .enabled(!this.busy)
          .onClick(() => this.clearCache())
        Button(this.busy ? '同步中' : '立即同步')
          .type(ButtonType.Normal).height(46).borderRadius(12).layoutWeight(2)
          .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
          .enabled(!this.busy)
          .onClick(() => {
            this.syncNow();
          })
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 8, bottom: 24 })
  }

  @Builder
  sheetContent() {
    if (this.sheet === 'password') {
      this.passwordSheet()
    } else if (this.sheet === 'appearance') {
      this.appearanceSheet()
    } else {
      this.offlineSheet()
    }
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Text('我的').fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
          .width('100%').padding({ top: 16 })

        Row({ space: 14 }) {
          Text(Fmt.initials(this.userName.length > 0 ? this.userName : '?'))
            .width(56).height(56).borderRadius(18).textAlign(TextAlign.Center)
            .fontSize(20).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.brand_tint'))
          Column({ space: 3 }) {
            Text(this.userName).fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
            Text(`${this.userRole === 'ADMIN' ? '管理员' : '销售顾问'} · ${this.userEmail}`).fontSize(13).fontColor($r('app.color.ink2'))
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text('LVANJU 绿安居').fontSize(13).fontColor($r('app.color.ink3'))
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .padding(16)
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))

        Column() {
          this.cell('trending-up', '数据分析', '业绩 · 转化 · 趋势', () => {
            this.pathStack.pushPathByName(Routes.ANALYTICS, new RouteParam(''));
          })
          Divider().color($r('app.color.line_soft')).margin({ left: 62 })
          this.cell('list-todo', '我的待办', '今天 · 逾期 · 全部', () => {
            this.pathStack.pushPathByName(Routes.TASKS, new RouteParam(''));
          })
        }
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))

        this.group('账号与安全')
        Column() {
          this.cell('key-round', '修改密码', '', () => this.open('password'))
          Divider().color($r('app.color.line_soft')).margin({ left: 62 })
          this.cell('smartphone', '退出其他设备', '电脑和其他手机', () => this.confirmSignOutOthers())
        }
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))

        this.group('设置')
        Column() {
          this.cell('eye', '外观', '@mode', () => this.open('appearance'))
          Divider().color($r('app.color.line_soft')).margin({ left: 62 })
          this.cell('cloud-download', '离线数据', '@cache', () => this.open('offline'))
        }
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))

        this.group('关于')
        Column() {
          this.cell('refresh-cw', '检查更新', '@update', () => {
            this.checkUpdate();
          })
          Divider().color($r('app.color.line_soft')).margin({ left: 62 })
          this.cell('server', '服务器', Session.baseUrl().replace('https://', ''), () => {})
        }
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))

        Row({ space: 12 }) {
          LvIcon({ name: 'log-out', iconColor: $r('app.color.danger'), iconSize: 19 })
          Text(this.busy ? '请稍候' : '退出登录').fontSize(15).fontColor($r('app.color.danger'))
        }
        .width('100%')
        .height(56)
        .padding({ left: 16, right: 16 })
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))
        .enabled(!this.busy)
        .onClick(() => this.confirmLogout())
        .margin({ top: 4 })

        Text(`LVANJUBOS ${AppConfig.VERSION} · 企业内部版`).fontSize(12).fontColor($r('app.color.ink3'))
          .width('100%').textAlign(TextAlign.Center)
      }
      .padding({ left: 16, right: 16, bottom: 24 })
    }
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
    .bindSheet($$this.showSheet, this.sheetContent(), {
      detents: [SheetSize.MEDIUM, SheetSize.LARGE],
      dragBar: true
    })
  }
}
