import { Api } from '../../api/Http';
import { Repo } from '../../api/Repo';
import { PolishResult, PolishSuggestion } from '../../api/Models';
import { LvIcon } from '../../components/LvIcon';
import { Pill } from '../../components/Ui';

/**
 * 优化话术 (POST /api/inbox/polish): three ways to say what the salesperson wrote, each in the customer's language
 * with its Chinese and what changed. Choosing one only fills the input box; nothing is sent from here.
 */
@Component
export struct PolishSheet {
  @Prop customerId: string = '';
  @Prop text: string = '';
  onUse: (text: string, zh: string) => void = () => {};
  onClose: () => void = () => {};
  @State state: string = 'loading';
  @State error: string = '';
  @State suggestions: PolishSuggestion[] = [];
  @State priceAsked: boolean = false;
  private seen: string[] = [];

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.state = 'loading';
    this.error = '';
    try {
      const result: PolishResult = await Repo.polish(this.customerId, this.text, this.seen.slice(-9));
      this.suggestions = result.suggestions;
      this.priceAsked = result.priceAsked;
      result.suggestions.forEach((s: PolishSuggestion) => {
        this.seen.push(s.text);
      });
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      this.state = 'error';
    }
  }

  @Builder
  card(s: PolishSuggestion) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Pill({ text: s.angle, tone: 'brand' })
        if (s.why.length > 0) {
          Text(s.why).fontSize(12).fontColor($r('app.color.ink3')).layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .width('100%')
      Text(s.text).fontSize(15).fontColor($r('app.color.ink')).lineHeight(22).copyOption(CopyOptions.LocalDevice)
      if (s.zh.length > 0 && s.zh !== s.text) {
        Text(`中文：${s.zh}`).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(20)
      }
      ForEach(s.warnings, (w: string) => {
        Row({ space: 4 }) {
          LvIcon({ name: 'triangle-alert', iconColor: $r('app.color.danger'), iconSize: 14 })
          Text(w).fontSize(12).fontColor($r('app.color.danger')).layoutWeight(1)
        }
        .width('100%')
      }, (w: string): string => w)
      Button('用这条')
        .type(ButtonType.Normal).height(38).borderRadius(10).fontSize(14)
        .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
        .onClick(() => {
          this.onUse(s.text, s.zh);
        })
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .backgroundColor($r('app.color.surface2'))
  }

  build() {
    Column() {
      Row() {
        Text('优化话术').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink')).layoutWeight(1)
        Row() {
          LvIcon({ name: 'x', iconColor: $r('app.color.ink2'), iconSize: 22 })
        }
        .width(40).height(40).justifyContent(FlexAlign.Center)
        .onClick(() => this.onClose())
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 4, bottom: 8 })

      Scroll() {
        Column({ space: 12 }) {
          Column({ space: 4 }) {
            Text('你写的').fontSize(12).fontColor($r('app.color.ink3'))
            Text(this.text).fontSize(14).fontColor($r('app.color.ink2')).lineHeight(20)
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')

          if (this.priceAsked) {
            Row({ space: 6 }) {
              LvIcon({ name: 'info', iconColor: $r('app.color.warning'), iconSize: 16 })
              Text('客户在问价格：价格以报价单为准，聊天里不要直接报价。').fontSize(13).fontColor($r('app.color.ink2')).layoutWeight(1)
            }
            .width('100%')
            .padding(10)
            .borderRadius(10)
            .backgroundColor($r('app.color.warning_bg'))
          }

          if (this.state === 'loading') {
            Column({ space: 10 }) {
              LoadingProgress().width(32).height(32).color($r('app.color.brand_ink'))
              Text('AI 正在结合聊天记录改写，约 10–30 秒').fontSize(13).fontColor($r('app.color.ink3'))
            }
            .width('100%')
            .padding(24)
          } else if (this.state === 'error') {
            Text(this.error).fontSize(14).fontColor($r('app.color.danger')).lineHeight(21)
            Button('重试')
              .type(ButtonType.Normal).height(40).borderRadius(10)
              .fontColor($r('app.color.ink')).backgroundColor($r('app.color.surface2'))
              .onClick(() => {
                this.load();
              })
          } else {
            ForEach(this.suggestions, (s: PolishSuggestion) => {
              this.card(s)
            }, (s: PolishSuggestion): string => s.text)
            Button('换一批')
              .type(ButtonType.Normal).width('100%').height(44).borderRadius(12)
              .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.brand_soft'))
              .onClick(() => {
                this.load();
              })
          }
          Text('AI 只改说法，不会替你加价格、交期、数量等承诺；发出前请再看一遍。').fontSize(12).fontColor($r('app.color.ink3'))
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 24 })
      }
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }
}
