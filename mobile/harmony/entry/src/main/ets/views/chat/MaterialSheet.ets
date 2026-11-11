import { Api } from '../../api/Http';
import { Repo } from '../../api/Repo';
import { AttachItem, MaterialFile, MaterialPicker, ProductImage, ProductMaterial, RecentFile } from '../../api/Models';
import { AuthImage } from '../../components/AuthImage';
import { LvIcon } from '../../components/LvIcon';
import { Pill } from '../../components/Ui';

const MAX_PICK = 10;

function sizeText(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fileIcon(mimeType: string): string {
  return mimeType.startsWith('image/') ? 'image' : 'file-text';
}

/**
 * 产品资料 (GET /api/inbox/materials): the company library (customer's language first), product photos and files I
 * sent recently. Up to 10 can be chosen; the chat copies them to the customer (POST /api/inbox/materials) and sends
 * them one by one through the normal WhatsApp send.
 */
@Component
export struct MaterialSheet {
  @Prop customerId: string = '';
  onSend: (items: AttachItem[]) => void = () => {};
  onClose: () => void = () => {};
  @State state: string = 'loading';
  @State error: string = '';
  @State data: MaterialPicker | null = null;
  @State segment: number = 0;
  @State keyword: string = '';
  @State selected: string[] = [];
  private searchTimer: number = -1;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      this.data = await Repo.materials(this.customerId, this.keyword.trim());
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      this.state = 'error';
    }
  }

  private onSearch(value: string): void {
    this.keyword = value;
    if (this.searchTimer !== -1) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.load();
    }, 400);
  }

  private isPicked(key: string): boolean {
    return this.selected.indexOf(key) >= 0;
  }

  private toggle(key: string): void {
    const index = this.selected.indexOf(key);
    if (index >= 0) {
      const next = this.selected.slice();
      next.splice(index, 1);
      this.selected = next;
    } else if (this.selected.length < MAX_PICK) {
      this.selected = this.selected.concat([key]);
    } else {
      this.getUIContext().getPromptAction().showToast({ message: `一次最多发 ${MAX_PICK} 个`, duration: 1800 });
    }
  }

  private send(): void {
    const items: AttachItem[] = this.selected.map((key: string): AttachItem => {
      const cut = key.indexOf(':');
      const item: AttachItem = { kind: key.slice(0, cut), id: key.slice(cut + 1) };
      return item;
    });
    this.onSend(items);
  }

  @Builder
  check(picked: boolean) {
    Row() {
      if (picked) {
        LvIcon({ name: 'check', iconColor: Color.White, iconSize: 14 })
      }
    }
    .width(22)
    .height(22)
    .borderRadius(11)
    .justifyContent(FlexAlign.Center)
    .backgroundColor(picked ? $r('app.color.brand') : $r('app.color.surface'))
    .border({ width: picked ? 0 : 1.5, color: $r('app.color.ink3') })
  }

  @Builder
  fileRow(icon: string, title: string, sub: string, tag: string, key: string) {
    Row({ space: 12 }) {
      Row() {
        LvIcon({ name: icon, iconColor: $r('app.color.brand_ink'), iconSize: 20 })
      }
      .width(40).height(40).borderRadius(10).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.brand_soft'))
      Column({ space: 3 }) {
        Text(title).fontSize(15).fontColor($r('app.color.ink')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 6 }) {
          if (tag.length > 0) {
            Pill({ text: tag, tone: 'neutral' })
          }
          Text(sub).fontSize(12).fontColor($r('app.color.ink3')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      this.check(this.isPicked(key))
    }
    .width('100%')
    .padding(12)
    .borderRadius(12)
    .backgroundColor(this.isPicked(key) ? $r('app.color.brand_tint') : $r('app.color.surface2'))
    .onClick(() => this.toggle(key))
  }

  @Builder
  productCard(p: ProductMaterial) {
    Column({ space: 8 }) {
      Text(`${p.model}${p.name.length > 0 ? ` · ${p.name}` : ''}`).fontSize(14).fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.ink')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      Scroll() {
        Row({ space: 8 }) {
          ForEach(p.images, (img: ProductImage) => {
            Stack({ alignContent: Alignment.TopEnd }) {
              AuthImage({ src: img.src, maxSide: 320, boxWidth: 96, boxHeight: 96 })
              Row() {
                this.check(this.isPicked(`PRODUCT_IMAGE:${img.id}`))
              }
              .padding({ top: 6, right: 6 })
            }
            .onClick(() => this.toggle(`PRODUCT_IMAGE:${img.id}`))
          }, (img: ProductImage): string => img.id)
        }
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(12)
    .borderRadius(12)
    .backgroundColor($r('app.color.surface2'))
  }

  @Builder
  listView(d: MaterialPicker) {
    List({ space: 10 }) {
      if (this.segment === 0) {
        if (d.files.length === 0) {
          ListItem() {
            Text('资料库里还没有文件。可以在电脑端「资料库」上传目录、证书、报价说明等。').fontSize(14)
              .fontColor($r('app.color.ink3')).lineHeight(21)
          }
        }
        ForEach(d.files, (f: MaterialFile) => {
          ListItem() {
            this.fileRow(fileIcon(f.mimeType), f.title.length > 0 ? f.title : f.fileName, `${f.fileName} · ${sizeText(f.size)}`,
              f.language.length > 0 ? f.language.toUpperCase() : '', `MATERIAL:${f.id}`)
          }
        }, (f: MaterialFile): string => f.id)
      } else if (this.segment === 1) {
        if (d.products.length === 0) {
          ListItem() {
            Text('没有找到带图片的产品。').fontSize(14).fontColor($r('app.color.ink3'))
          }
        }
        ForEach(d.products, (p: ProductMaterial) => {
          ListItem() {
            this.productCard(p)
          }
        }, (p: ProductMaterial): string => p.id)
      } else {
        if (d.recent.length === 0) {
          ListItem() {
            Text('最近 60 天没有从 BOS 发过文件。').fontSize(14).fontColor($r('app.color.ink3'))
          }
        }
        ForEach(d.recent, (r: RecentFile) => {
          ListItem() {
            this.fileRow(fileIcon(r.mimeType), r.fileName, `发给 ${r.to}`, '', `RECENT:${r.id}`)
          }
        }, (r: RecentFile): string => r.id)
      }
    }
    .cachedCount(4)
    .padding({ left: 16, right: 16, bottom: 12 })
    .scrollBar(BarState.Off)
    .layoutWeight(1)
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text('产品资料').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink')).layoutWeight(1)
        Row() {
          LvIcon({ name: 'x', iconColor: $r('app.color.ink2'), iconSize: 22 })
        }
        .width(40).height(40).justifyContent(FlexAlign.Center)
        .onClick(() => this.onClose())
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 4 })

      Search({ value: this.keyword, placeholder: '搜索资料名、产品型号' })
        .height(42)
        .margin({ left: 16, right: 16 })
        .backgroundColor($r('app.color.surface2'))
        .onChange((value: string): void => this.onSearch(value))

      Row({ space: 2 }) {
        ForEach(['资料文件', '产品图片', '最近发过'], (title: string, index: number) => {
          Text(title)
            .fontSize(14)
            .fontWeight(this.segment === index ? FontWeight.Medium : FontWeight.Normal)
            .fontColor(this.segment === index ? $r('app.color.ink') : $r('app.color.ink2'))
            .textAlign(TextAlign.Center)
            .height(36)
            .layoutWeight(1)
            .borderRadius(9)
            .backgroundColor(this.segment === index ? $r('app.color.surface') : Color.Transparent)
            .onClick(() => {
              this.segment = index;
            })
        }, (title: string): string => title)
      }
      .padding(3)
      .borderRadius(12)
      .backgroundColor($r('app.color.surface2'))
      .margin({ left: 16, right: 16 })

      if (this.state === 'loading') {
        LoadingProgress().width(32).height(32).color($r('app.color.brand_ink')).margin({ top: 24 })
        Blank()
      } else if (this.state === 'error' || this.data === null) {
        Text(this.error).fontSize(14).fontColor($r('app.color.danger')).padding(16)
        Blank()
      } else {
        this.listView(this.data as MaterialPicker)
      }

      Row({ space: 10 }) {
        Text(this.selected.length > 0 ? `已选 ${this.selected.length} 个` : '点选要发的资料（最多 10 个）')
          .fontSize(13).fontColor($r('app.color.ink2')).layoutWeight(1)
        Button(this.selected.length > 0 ? `发送 ${this.selected.length} 个` : '发送')
          .type(ButtonType.Normal).height(44).borderRadius(12)
          .fontColor($r('app.color.on_brand'))
          .backgroundColor(this.selected.length > 0 ? $r('app.color.brand') : $r('app.color.ink3'))
          .enabled(this.selected.length > 0)
          .onClick(() => this.send())
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 16 })
      .border({ width: { top: 0.5 }, color: $r('app.color.line') })
    }
    .width('100%')
    .height('100%')
  }
}
