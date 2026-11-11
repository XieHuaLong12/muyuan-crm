import { AppConfig } from '../common/Config';
import { Fmt } from '../common/Format';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { LvIcon } from '../components/LvIcon';

/** 我的: account, server, version, sign out. Notification settings and updates come in later versions. */
@Component
export struct MeTab {
  @StorageProp('userName') userName: string = '';
  @StorageProp('userRole') userRole: string = '';
  @StorageProp('userEmail') userEmail: string = '';
  @State busy: boolean = false;

  private confirmLogout(): void {
    this.getUIContext().showAlertDialog({
      title: '退出登录？',
      message: '退出后需要重新输入邮箱和密码。',
      autoCancel: true,
      alignment: DialogAlignment.Center,
      primaryButton: {
        value: '取消',
        action: () => {}
      },
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
      hilogLess(Api.message(e));
    } finally {
      this.busy = false;
    }
  }

  @Builder
  cell(icon: string, title: string, value: string) {
    Row({ space: 12 }) {
      Row() {
        LvIcon({ name: icon, iconColor: $r('app.color.brand_ink'), iconSize: 19 })
      }
      .width(34).height(34).borderRadius(10).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.brand_tint'))
      Text(title).fontSize(15).fontColor($r('app.color.ink')).layoutWeight(1)
      Text(value).fontSize(14).fontColor($r('app.color.ink3')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .height(56)
    .padding({ left: 16, right: 16 })
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
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
          this.cell('server', '服务器', Session.baseUrl().replace('https://', ''))
          Divider().color($r('app.color.line_soft')).margin({ left: 62 })
          this.cell('info', '版本', `${AppConfig.VERSION}（企业内部版）`)
        }
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))

        Row({ space: 12 }) {
          LvIcon({ name: 'log-out', iconColor: $r('app.color.danger'), iconSize: 19 })
          Text(this.busy ? '正在退出' : '退出登录').fontSize(15).fontColor($r('app.color.danger'))
        }
        .width('100%')
        .height(56)
        .padding({ left: 16, right: 16 })
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))
        .enabled(!this.busy)
        .onClick(() => this.confirmLogout())

        Text('最近打开过的客户、订单和对话会保存在这台手机上，没有网络时也能查看；退出登录会清除。').fontSize(12).fontColor($r('app.color.ink3')).lineHeight(18)
          .width('100%').textAlign(TextAlign.Center)
      }
      .padding({ left: 16, right: 16, bottom: 24 })
    }
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
  }
}

/** Logging without a toast: the user is already back on the login page. */
function hilogLess(message: string): void {
  console.warn(`logout: ${message}`);
}
