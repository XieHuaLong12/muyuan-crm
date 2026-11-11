import { LvIcon } from './LvIcon';
import { Fmt } from '../common/Format';

/**
 * Design-system components (docs/mobile-app/DESIGN_SYSTEM.md §6). Colours come only from the generated
 * resources (resources/base|dark/element/color.json), so light and dark follow the system theme.
 */

export function toneInk(tone: string): Resource {
  if (tone === 'success') return $r('app.color.success');
  if (tone === 'warning') return $r('app.color.warning');
  if (tone === 'danger') return $r('app.color.danger');
  if (tone === 'info') return $r('app.color.info');
  if (tone === 'brand') return $r('app.color.brand_ink');
  return $r('app.color.ink2');
}

export function toneBg(tone: string): Resource {
  if (tone === 'success') return $r('app.color.success_bg');
  if (tone === 'warning') return $r('app.color.warning_bg');
  if (tone === 'danger') return $r('app.color.danger_bg');
  if (tone === 'info') return $r('app.color.info_bg');
  if (tone === 'brand') return $r('app.color.brand_soft');
  return $r('app.color.surface2');
}

/** Status badge: stage, payment, priority. Colour carries state; the text always says it too. */
@Component
export struct Pill {
  @Prop text: string = '';
  @Prop tone: string = 'neutral';

  build() {
    Text(this.text)
      .fontSize(12)
      .fontWeight(FontWeight.Medium)
      .fontColor(toneInk(this.tone))
      .backgroundColor(toneBg(this.tone))
      .borderRadius(6)
      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
      .maxLines(1)
  }
}

/** Lead grade A–D on one green ramp (lib/lead-grade.ts). */
@Component
export struct GradeMark {
  @Prop grade: string = '';
  @Prop markSize: number = 18;

  private bg(): Resource {
    if (this.grade === 'A') return $r('app.color.brand');
    if (this.grade === 'B') return $r('app.color.brand_soft');
    return $r('app.color.surface2');
  }

  private ink(): Resource {
    if (this.grade === 'A') return $r('app.color.on_brand');
    if (this.grade === 'B') return $r('app.color.brand_ink');
    return $r('app.color.ink3');
  }

  build() {
    Text(this.grade.length > 0 ? this.grade : '–')
      .width(this.markSize)
      .height(this.markSize)
      .textAlign(TextAlign.Center)
      .fontSize(this.markSize * 0.6)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.ink())
      .backgroundColor(this.bg())
      .borderRadius(this.markSize * 0.33)
      .decoration({ type: this.grade === 'D' ? TextDecorationType.LineThrough : TextDecorationType.None })
  }
}

/** Initials avatar with the lead grade in the corner. */
@Component
export struct Avatar {
  @Prop name: string = '';
  @Prop grade: string = '';
  @Prop avatarSize: number = 44;

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Text(Fmt.initials(this.name))
        .width(this.avatarSize)
        .height(this.avatarSize)
        .textAlign(TextAlign.Center)
        .fontSize(this.avatarSize * 0.34)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.brand_ink'))
        .backgroundColor($r('app.color.brand_tint'))
        .borderRadius(this.avatarSize * 0.32)
      if (this.grade.length > 0) {
        GradeMark({ grade: this.grade, markSize: 18 })
          .border({ width: 2, color: $r('app.color.surface'), radius: 6 })
          .offset({ x: 4, y: 4 })
      }
    }
    .width(this.avatarSize)
    .height(this.avatarSize)
  }
}

/** Section title with an optional link on the right. */
@Component
export struct SectionHead {
  @Prop title: string = '';
  @Prop sub: string = '';
  @Prop link: string = '';
  onLink: () => void = () => {};

  build() {
    Row() {
      Row({ space: 6 }) {
        Text(this.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        if (this.sub.length > 0) {
          Text(this.sub).fontSize(13).fontColor($r('app.color.ink3'))
        }
      }
      Blank()
      if (this.link.length > 0) {
        Row({ space: 2 }) {
          Text(this.link).fontSize(13).fontColor($r('app.color.brand_ink'))
          LvIcon({ name: 'chevron-right', iconColor: $r('app.color.brand_ink'), iconSize: 16 })
        }
        .height(32)
        .onClick(() => this.onLink())
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16 })
    .alignItems(VerticalAlign.Center)
  }
}

/**
 * Loading, empty and error states (docs/mobile-app/INFORMATION_ARCHITECTURE.md §4).
 * kind: loading | empty | error
 */
@Component
export struct StateView {
  @Prop kind: string = 'loading';
  @Prop icon: string = 'inbox';
  @Prop title: string = '';
  @Prop message: string = '';
  @Prop actionText: string = '';
  onAction: () => void = () => {};

  build() {
    Column({ space: 10 }) {
      if (this.kind === 'loading') {
        LoadingProgress().width(36).height(36).color($r('app.color.brand_ink'))
        Text('加载中').fontSize(13).fontColor($r('app.color.ink3'))
      } else {
        Row() {
          LvIcon({ name: this.kind === 'error' ? 'wifi-off' : this.icon, iconColor: this.kind === 'error' ? $r('app.color.danger') : $r('app.color.brand_ink'), iconSize: 26 })
        }
        .width(56)
        .height(56)
        .borderRadius(18)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.kind === 'error' ? $r('app.color.danger_bg') : $r('app.color.brand_tint'))
        Text(this.title.length > 0 ? this.title : this.kind === 'error' ? '加载失败' : '这里还没有内容')
          .fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        if (this.message.length > 0) {
          Text(this.message).fontSize(14).fontColor($r('app.color.ink3')).textAlign(TextAlign.Center).lineHeight(22)
        }
        if (this.actionText.length > 0) {
          Button(this.actionText)
            .type(ButtonType.Normal)
            .borderRadius(12)
            .height(44)
            .fontColor($r('app.color.ink'))
            .backgroundColor($r('app.color.surface'))
            .border({ width: 1, color: $r('app.color.line') })
            .margin({ top: 4 })
            .onClick(() => this.onAction())
        }
      }
    }
    .width('100%')
    .padding({ left: 28, right: 28, top: 48, bottom: 48 })
    .justifyContent(FlexAlign.Center)
  }
}

/** Stat tile: label + icon, big number, one line of context. */
@Component
export struct StatTile {
  @Prop label: string = '';
  @Prop icon: string = '';
  @Prop value: string = '—';
  @Prop foot: string = '';
  @Prop footWarn: boolean = false;
  onTap: () => void = () => {};

  build() {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        LvIcon({ name: this.icon, iconColor: $r('app.color.ink3'), iconSize: 16 })
        Text(this.label).fontSize(13).fontColor($r('app.color.ink2'))
      }
      Text(this.value).fontSize(26).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
      if (this.foot.length > 0) {
        Text(this.foot)
          .fontSize(12)
          .fontColor(this.footWarn ? $r('app.color.danger') : $r('app.color.ink3'))
          .fontWeight(this.footWarn ? FontWeight.Medium : FontWeight.Normal)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .layoutWeight(1)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
    .border({ width: 0.5, color: $r('app.color.line_soft') })
    .onClick(() => this.onTap())
  }
}

/** Seven-stage order flow (lib/order-status.ts): done stages filled, current ringed, cancelled greyed out. */
@Component
export struct OrderSteps {
  @Prop done: boolean[] = [];
  @Prop cancelled: boolean = false;
  @Prop labels: string[] = [];

  build() {
    Row() {
      ForEach(this.labels, (stage: string, index: number) => {
        Column({ space: 6 }) {
          Row() {
            if (!this.cancelled && this.done[index] === true) {
              LvIcon({ name: 'check', iconColor: $r('app.color.on_brand'), iconSize: 12 })
            }
          }
          .width(20)
          .height(20)
          .borderRadius(10)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(!this.cancelled && this.done[index] === true ? $r('app.color.brand') : $r('app.color.surface'))
          .border({ width: 2, color: !this.cancelled && this.done[index] === true ? $r('app.color.brand') : $r('app.color.line') })
          Text(stage)
            .fontSize(11)
            .fontColor(!this.cancelled && this.done[index] === true ? $r('app.color.ink2') : $r('app.color.ink3'))
        }
        .layoutWeight(1)
      }, (stage: string): string => stage)
    }
    .width('100%')
  }
}
