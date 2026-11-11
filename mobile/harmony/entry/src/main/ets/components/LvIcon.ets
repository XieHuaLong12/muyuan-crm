import { ICON_PATHS } from './IconData';

/**
 * Lucide line icon (same set and version as the PC BOS). The path data is on a 24-unit grid; Path draws in px,
 * so the numbers are scaled once to the icon size. Stroke 1.75 on the 24 grid, round caps and joins.
 */
@Component
export struct LvIcon {
  @Prop name: string = '';
  @Prop iconColor: ResourceColor = $r('app.color.ink');
  @Prop size: number = 22;

  private commands(): string {
    const d = ICON_PATHS[this.name];
    if (d === undefined) return '';
    const k = vp2px(this.size) / 24;
    return d.replace(/-?\d*\.?\d+/g, (n: string): string => (parseFloat(n) * k).toFixed(2));
  }

  build() {
    Path()
      .width(this.size)
      .height(this.size)
      .commands(this.commands())
      .fill(Color.Transparent)
      .stroke(this.iconColor)
      .strokeWidth(this.size * 1.75 / 24)
      .strokeLineCap(LineCapStyle.Round)
      .strokeLineJoin(LineJoinStyle.Round)
  }
}
