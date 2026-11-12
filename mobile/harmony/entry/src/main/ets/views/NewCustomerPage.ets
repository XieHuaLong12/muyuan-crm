import { RouteParam, Routes, StoreKeys } from '../common/Config';
import { PURCHASES, SOURCES, label } from '../common/Labels';
import { Api, ApiError } from '../api/Http';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { NewCustomerBody, SalesAccount } from '../api/Models';

const SOURCE_KEYS: string[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WHATSAPP', 'WEBSITE', 'ALIBABA', 'EXHIBITION', 'REFERRAL', 'OUTBOUND', 'OTHER'];
const PURCHASE_KEYS: string[] = ['WHOLESALE', 'IMPORTER', 'DISTRIBUTOR', 'RETAILER', 'BRAND', 'ECOMMERCE', 'OTHER'];

/**
 * 新建客户 (POST /api/customers, lib/validation.ts customerSchema). The server checks for an existing customer with
 * the same WhatsApp, phone or email; an administrator may still create it after seeing that warning (forceDuplicate),
 * a salesperson cannot — the same rule as on the PC. Sales own the customers they create.
 */
@Component
export struct NewCustomerPage {
  @Consume('pathStack') pathStack: NavPathStack;
  @State name: string = '';
  @State whatsapp: string = '';
  @State phone: string = '';
  @State email: string = '';
  @State country: string = '';
  @State company: string = '';
  @State product: string = '';
  @State quantity: string = '';
  @State notes: string = '';
  @State source: string = 'WHATSAPP';
  @State purchase: string = 'OTHER';
  @State ownerId: string = '';
  @State accounts: SalesAccount[] = [];
  @State saving: boolean = false;
  @State error: string = '';

  aboutToAppear(): void {
    this.ownerId = Session.userId();
    if (Session.isAdmin()) {
      this.loadAccounts();
    }
  }

  private async loadAccounts(): Promise<void> {
    try {
      const rows = await Repo.salesAccounts();
      this.accounts = rows.filter((a: SalesAccount): boolean => a.isActive);
    } catch (e) {
      this.accounts = [];
    }
  }

  private body(force: boolean): NewCustomerBody {
    const qty = Number(this.quantity.trim());
    const body: NewCustomerBody = {
      name: this.name.trim(), companyName: this.company.trim(), country: this.country.trim(), whatsapp: this.whatsapp.trim(),
      phone: this.phone.trim(), email: this.email.trim(), source: this.source, productInterest: this.product.trim(),
      purchaseType: this.purchase, quantity: this.quantity.trim().length > 0 && Number.isInteger(qty) && qty >= 0 ? qty : null,
      notes: this.notes.trim(), ownerId: this.ownerId
    };
    if (force) {
      body.forceDuplicate = true;
    }
    return body;
  }

  private async save(force: boolean): Promise<void> {
    if (this.name.trim().length === 0) {
      this.error = '请填写客户姓名';
      return;
    }
    if (this.whatsapp.trim().length === 0 && this.phone.trim().length === 0 && this.email.trim().length === 0) {
      this.error = 'WhatsApp、电话、邮箱至少填一个，方便查重和联系';
      return;
    }
    if (this.ownerId.length === 0) {
      this.error = '没有读到当前账号，请到「我的」退出后重新登录';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const created = await Repo.createCustomer(this.body(force));
      this.getUIContext().getPromptAction().showToast({ message: `已建档：${created.name}`, duration: 2000 });
      AppStorage.setOrCreate<number>(StoreKeys.DATA_CHANGED, Date.now());
      this.pathStack.replacePathByName(Routes.CUSTOMER, new RouteParam(created.id));
    } catch (e) {
      const message = Api.message(e);
      if (e instanceof ApiError && (e as ApiError).status === 409 && Session.isAdmin() && !force) {
        this.confirmDuplicate(message);
      } else {
        this.error = message;
      }
    } finally {
      this.saving = false;
    }
  }

  private confirmDuplicate(message: string): void {
    this.getUIContext().showAlertDialog({
      title: '可能是重复客户',
      message: message,
      autoCancel: true,
      alignment: DialogAlignment.Center,
      primaryButton: { value: '返回检查', action: () => {} },
      secondaryButton: {
        value: '仍然新建',
        action: () => {
          this.save(true);
        }
      }
    });
  }

  @Builder
  field(title: string, placeholder: string, which: string, type: InputType) {
    Column({ space: 6 }) {
      Text(title).fontSize(13).fontColor($r('app.color.ink2'))
      TextInput({ placeholder: placeholder, text: this.fieldValue(which) })
        .type(type)
        .height(46)
        .fontSize(16)
        .backgroundColor($r('app.color.surface'))
        .onChange((v: string) => this.setValue(which, v))
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  private fieldValue(which: string): string {
    if (which === 'name') return this.name;
    if (which === 'whatsapp') return this.whatsapp;
    if (which === 'phone') return this.phone;
    if (which === 'email') return this.email;
    if (which === 'country') return this.country;
    if (which === 'company') return this.company;
    if (which === 'product') return this.product;
    return this.quantity;
  }

  private setValue(which: string, v: string): void {
    this.error = '';
    if (which === 'name') this.name = v;
    else if (which === 'whatsapp') this.whatsapp = v;
    else if (which === 'phone') this.phone = v;
    else if (which === 'email') this.email = v;
    else if (which === 'country') this.country = v;
    else if (which === 'company') this.company = v;
    else if (which === 'product') this.product = v;
    else this.quantity = v;
  }

  @Builder
  choice(title: string, keys: string[], map: Record<string, string>, which: string) {
    Column({ space: 6 }) {
      Text(title).fontSize(13).fontColor($r('app.color.ink2'))
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(keys, (key: string) => {
          Text(label(map, key))
            .fontSize(14)
            .fontColor((which === 'source' ? this.source : this.purchase) === key ? $r('app.color.on_brand') : $r('app.color.ink2'))
            .backgroundColor((which === 'source' ? this.source : this.purchase) === key ? $r('app.color.brand') : $r('app.color.surface'))
            .borderRadius(17)
            .height(34)
            .padding({ left: 12, right: 12 })
            .margin({ right: 8, bottom: 8 })
            .onClick(() => {
              if (which === 'source') {
                this.source = key;
              } else {
                this.purchase = key;
              }
            })
        }, (key: string): string => key)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  build() {
    NavDestination() {
      Column() {
        Scroll() {
          Column({ space: 14 }) {
            this.field('客户姓名 *', '例如 Ahmed Al-Harbi', 'name', InputType.Normal)
            this.field('WhatsApp', '带国家区号，例如 +966 50 123 4567', 'whatsapp', InputType.PhoneNumber)
            this.field('电话', '没有可不填', 'phone', InputType.PhoneNumber)
            this.field('邮箱', '没有可不填', 'email', InputType.Email)
            Row({ space: 10 }) {
              Column() {
                this.field('国家', '例如 Saudi Arabia', 'country', InputType.Normal)
              }
              .layoutWeight(1)
              Column() {
                this.field('公司', '可不填', 'company', InputType.Normal)
              }
              .layoutWeight(1)
            }
            this.choice('来源', SOURCE_KEYS, SOURCES, 'source')
            this.choice('采购身份', PURCHASE_KEYS, PURCHASES, 'purchase')
            Row({ space: 10 }) {
              Column() {
                this.field('意向产品', '例如 床垫 / 沙发床', 'product', InputType.Normal)
              }
              .layoutWeight(2)
              Column() {
                this.field('数量', '件', 'quantity', InputType.Number)
              }
              .layoutWeight(1)
            }
            Column({ space: 6 }) {
              Text('备注').fontSize(13).fontColor($r('app.color.ink2'))
              TextArea({ placeholder: '客户需求、沟通要点', text: this.notes })
                .height(90).fontSize(15).backgroundColor($r('app.color.surface'))
                .onChange((v: string) => {
                  this.notes = v;
                })
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            if (Session.isAdmin() && this.accounts.length > 0) {
              Column({ space: 6 }) {
                Text('负责人').fontSize(13).fontColor($r('app.color.ink2'))
                Flex({ wrap: FlexWrap.Wrap }) {
                  ForEach(this.accounts, (a: SalesAccount) => {
                    Text(a.id === Session.userId() ? `${a.name}（我）` : a.name)
                      .fontSize(14)
                      .fontColor(this.ownerId === a.id ? $r('app.color.on_brand') : $r('app.color.ink2'))
                      .backgroundColor(this.ownerId === a.id ? $r('app.color.brand') : $r('app.color.surface'))
                      .borderRadius(17)
                      .height(34)
                      .padding({ left: 12, right: 12 })
                      .margin({ right: 8, bottom: 8 })
                      .onClick(() => {
                        this.ownerId = a.id;
                      })
                  }, (a: SalesAccount): string => a.id)
                }
              }
              .alignItems(HorizontalAlign.Start)
              .width('100%')
            }
            if (this.error.length > 0) {
              Text(this.error).fontSize(13).fontColor($r('app.color.danger')).lineHeight(19)
            }
          }
          .padding({ left: 16, right: 16, top: 8, bottom: 24 })
        }
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
        .layoutWeight(1)

        Column() {
          Button(this.saving ? '正在保存' : '保存客户')
            .type(ButtonType.Normal).width('100%').height(48).borderRadius(12)
            .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
            .enabled(!this.saving)
            .onClick(() => {
              this.save(false);
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 10, bottom: 12 })
        .backgroundColor($r('app.color.surface'))
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
      }
      .width('100%')
      .height('100%')
    }
    .title('新建客户')
    .backgroundColor($r('app.color.bg'))
  }
}
