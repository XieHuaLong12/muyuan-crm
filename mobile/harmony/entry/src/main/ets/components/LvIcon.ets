import { ICON_PATHS } from './IconData';

/** Scaled path per icon and pixel size: computed once, then every list row reuses it. */
const SCALED: Map<string, string> = new Map<string, string>();

/**
 * Lucide line icon (same set and version as the PC BOS). The path data is on a 24-unit grid; Path draws in px,
 * so the numbers are scaled once to the icon size. Stroke 1.75 on the 24 grid, round caps and joins.
 */
@Component
export struct LvIcon {
  @Prop name: string = '';
  @Prop iconColor: ResourceColor = $r('app.color.ink');
  @Prop iconSize: number = 22;

  private commands(): string {
    const d = ICON_PATHS[this.name];
    if (d === undefined) return '';
    const px = this.getUIContext().vp2px(this.iconSize);
    const key = `${this.name}|${px}`;
    const cached = SCALED.get(key);
    if (cached !== undefined) return cached;
    const k = px / 24;
    const scaled = d.replace(/-?\d*\.?\d+/g, (n: string): string => (parseFloat(n) * k).toFixed(2));
    SCALED.set(key, scaled);
    return scaled;
  }

  build() {
    Path()
      .width(this.iconSize)
      .height(this.iconSize)
      .commands(this.commands())
      .fill(Color.Transparent)
      .stroke(this.iconColor)
      .strokeWidth(this.iconSize * 1.75 / 24)
      .strokeLineCap(LineCapStyle.Round)
      .strokeLineJoin(LineJoinStyle.Round)
  }
}
