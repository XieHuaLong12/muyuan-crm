/**
 * A plain bar chart (DESIGN_SYSTEM.md 图表: one series, no gridlines, labels only at the ends).
 * Values are drawn relative to the largest one; zero shows as a faint stub so the time axis stays readable.
 */
@Component
export struct BarChart {
  @Prop values: number[] = [];
  @Prop startLabel: string = '';
  @Prop endLabel: string = '';
  @Prop chartHeight: number = 110;
  @Prop highlightLast: boolean = false;

  private largest(): number {
    let max = 0;
    for (let i = 0; i < this.values.length; i++) {
      if (this.values[i] > max) {
        max = this.values[i];
      }
    }
    return max;
  }

  private barHeight(v: number): number {
    const max = this.largest();
    if (max <= 0 || v <= 0) return 2;
    return Math.max(3, v / max * (this.chartHeight - 4));
  }

  build() {
    Column({ space: 6 }) {
      Row({ space: this.values.length > 20 ? 2 : 4 }) {
        ForEach(this.values, (v: number, index: number) => {
          Column() {
            Row()
              .width('100%')
              .height(this.barHeight(v))
              .borderRadius(2)
              .backgroundColor(v <= 0 ? $r('app.color.surface2')
                : this.highlightLast && index === this.values.length - 1 ? $r('app.color.brand') : $r('app.color.seq2'))
          }
          .layoutWeight(1)
          .height('100%')
          .justifyContent(FlexAlign.End)
        }, (v: number, index: number): string => `${index}:${v}`)
      }
      .width('100%')
      .height(this.chartHeight)
      .alignItems(VerticalAlign.Bottom)

      Row() {
        Text(this.startLabel).fontSize(11).fontColor($r('app.color.ink3'))
        Blank()
        Text(this.endLabel).fontSize(11).fontColor($r('app.color.ink3'))
      }
      .width('100%')
    }
    .width('100%')
  }
}
