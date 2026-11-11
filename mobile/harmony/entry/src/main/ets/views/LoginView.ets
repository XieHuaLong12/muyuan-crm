import { AppConfig } from '../common/Config';
import { Session } from '../api/Session';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { LvIcon } from '../components/LvIcon';

/**
 * Login with the BOS account (POST /api/auth/login). The server throttles failed attempts (8 per account and
 * address in 15 minutes, lib/login-throttle.ts) and its message is shown as-is.
 * 「服务器」 switches between the production site and the test site during development.
 */
@Component
export struct LoginView {
  @State email: string = '';
  @State password: string = '';
  @State busy: boolean = false;
  @State error: string = '';
  @State server: string = Session.baseUrl();
  @State editingServer: boolean = false;
  @State serverDraft: string = '';

  private async login(): Promise<void> {
    const email = this.email.trim();
    if (email.length === 0 || this.password.length === 0) {
      this.error = '请填写邮箱和密码';
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      await Repo.login(email, this.password);
      if (Session.cookieValue().length === 0) {
        this.error = '登录成功，但没有收到登录凭证。请联系管理员检查服务器的 HTTPS 设置。';
        return;
      }
      this.password = '';
      AppStorage.setOrCreate<boolean>('loggedIn', true);
    } catch (e) {
      this.error = Api.message(e);
    } finally {
      this.busy = false;
    }
  }

  private async saveServer(): Promise<void> {
    const value = this.serverDraft.trim();
    if (!/^https:\/\/[^\s/]+/.test(value)) {
      this.error = '服务器地址需要以 https:// 开头';
      return;
    }
    await Session.setBaseUrl(value);
    this.server = Session.baseUrl();
    this.editingServer = false;
    this.error = '';
  }

  build() {
    Scroll() {
      Column({ space: 22 }) {
        Column({ space: 10 }) {
          Image($r('app.media.lvanju_logo')).width(208).objectFit(ImageFit.Contain)
          Text('BOS 企业经营系统').fontSize(14).fontColor('#DBE9E2').letterSpacing(3)
        }
        .width('100%')
        .padding({ top: 56, bottom: 36 })
        .backgroundColor($r('app.color.logo'))
        .borderRadius({ bottomLeft: 28, bottomRight: 28 })

        Column({ space: 14 }) {
          Column({ space: 4 }) {
            Text('登录').fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
            Text('使用管理员为你开通的 BOS 账号').fontSize(14).fontColor($r('app.color.ink3'))
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')

          if (this.error.length > 0) {
            Row({ space: 8 }) {
              LvIcon({ name: 'circle-alert', iconColor: $r('app.color.danger'), iconSize: 18 })
              Text(this.error).fontSize(14).fontColor($r('app.color.danger')).layoutWeight(1)
            }
            .width('100%')
            .padding(12)
            .borderRadius(12)
            .backgroundColor($r('app.color.danger_bg'))
          }

          Column({ space: 6 }) {
            Text('邮箱').fontSize(14).fontColor($r('app.color.ink2'))
            TextInput({ placeholder: 'name@company.com', text: this.email })
              .type(InputType.Email)
              .height(48)
              .fontSize(16)
              .borderRadius(12)
              .backgroundColor($r('app.color.surface'))
              .onChange((value: string) => {
                this.email = value;
              })
          }
          .alignItems(HorizontalAlign.Start)

          Column({ space: 6 }) {
            Text('密码').fontSize(14).fontColor($r('app.color.ink2'))
            TextInput({ placeholder: '密码', text: this.password })
              .type(InputType.Password)
              .showPasswordIcon(true)
              .height(48)
              .fontSize(16)
              .borderRadius(12)
              .backgroundColor($r('app.color.surface'))
              .onChange((value: string) => {
                this.password = value;
              })
              .onSubmit(() => {
                this.login();
              })
          }
          .alignItems(HorizontalAlign.Start)

          Button(this.busy ? '正在登录' : '登录')
            .type(ButtonType.Normal)
            .width('100%')
            .height(48)
            .borderRadius(12)
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.on_brand'))
            .backgroundColor($r('app.color.brand'))
            .enabled(!this.busy)
            .opacity(this.busy ? 0.6 : 1)
            .onClick(() => {
              this.login();
            })

          Text('忘记密码请联系管理员重置。同一账号连续输错 8 次，需等待 15 分钟再试。')
            .fontSize(13)
            .fontColor($r('app.color.ink3'))
            .textAlign(TextAlign.Center)
            .lineHeight(20)
            .width('100%')
        }
        .padding({ left: 22, right: 22 })

        Column({ space: 8 }) {
          if (this.editingServer) {
            TextInput({ placeholder: 'https://avenlee.online', text: this.serverDraft })
              .height(44)
              .fontSize(15)
              .borderRadius(12)
              .backgroundColor($r('app.color.surface'))
              .onChange((value: string) => {
                this.serverDraft = value;
              })
            Row({ space: 8 }) {
              Button('恢复默认').type(ButtonType.Normal).borderRadius(10).height(40).layoutWeight(1)
                .fontColor($r('app.color.ink')).backgroundColor($r('app.color.surface2'))
                .onClick(() => {
                  this.serverDraft = AppConfig.DEFAULT_SERVER;
                })
              Button('保存').type(ButtonType.Normal).borderRadius(10).height(40).layoutWeight(1)
                .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
                .onClick(() => {
                  this.saveServer();
                })
            }
          } else {
            Row({ space: 6 }) {
              LvIcon({ name: 'server', iconColor: $r('app.color.ink3'), iconSize: 14 })
              Text(`服务器：${this.server.replace('https://', '')}`).fontSize(12).fontColor($r('app.color.ink3'))
              Text('更改').fontSize(12).fontColor($r('app.color.brand_ink'))
            }
            .onClick(() => {
              this.serverDraft = this.server;
              this.editingServer = true;
            })
          }
        }
        .padding({ left: 22, right: 22, bottom: 24 })
        .width('100%')
        .alignItems(HorizontalAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
    .scrollBar(BarState.Off)
  }
}
