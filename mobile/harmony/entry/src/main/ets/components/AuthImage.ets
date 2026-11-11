import { image } from '@kit.ImageKit';
import { Media } from '../api/Media';

/**
 * A picture behind the sign-in (chat photos, product photos): downloaded with the session cookie when it is built
 * (LazyForEach builds it when it scrolls near the screen), decoded at maxSide px and kept in memory.
 * fullScreen = true fills the parent and keeps the whole picture visible (full-screen preview).
 */
@Component
export struct AuthImage {
  @Prop src: string = '';
  @Prop maxSide: number = 640;
  @Prop boxWidth: number = 200;
  @Prop boxHeight: number = 200;
  @Prop fullScreen: boolean = false;
  @State pixel: image.PixelMap | undefined = undefined;
  @State failed: boolean = false;

  aboutToAppear(): void {
    Media.thumbnail(this.src, this.maxSide).then((pixelMap: image.PixelMap) => {
      this.pixel = pixelMap;
    }).catch(() => {
      this.failed = true;
    });
  }

  build() {
    Stack() {
      if (this.pixel !== undefined) {
        Image(this.pixel as image.PixelMap)
          .width('100%')
          .height('100%')
          .objectFit(this.fullScreen ? ImageFit.Contain : ImageFit.Cover)
      } else if (this.failed) {
        Text('图片加载失败').fontSize(12).fontColor($r('app.color.ink3'))
      } else {
        LoadingProgress().width(28).height(28).color($r('app.color.ink3'))
      }
    }
    .width(this.fullScreen ? '100%' : this.boxWidth)
    .height(this.fullScreen ? '100%' : this.boxHeight)
    .borderRadius(this.fullScreen ? 0 : 10)
    .backgroundColor(this.fullScreen ? Color.Transparent : $r('app.color.surface2'))
    .clip(true)
  }
}
