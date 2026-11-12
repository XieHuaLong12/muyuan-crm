import { preferences } from '@kit.ArkData';
import { common, ConfigurationConstant } from '@kit.AbilityKit';

/** 外观: follow the phone, or always light / dark. Remembered on this phone and applied at start. */
export class Appearance {
  /** system | light | dark */
  static mode: string = 'system';
  private static prefs: preferences.Preferences | null = null;
  private static app: common.ApplicationContext | null = null;

  static async init(context: common.UIAbilityContext): Promise<void> {
    Appearance.app = context.getApplicationContext();
    try {
      Appearance.prefs = await preferences.getPreferences(context, 'lvanjubos_ui');
      Appearance.mode = (await Appearance.prefs.get('colorMode', 'system')) as string;
    } catch (e) {
      Appearance.mode = 'system';
    }
    Appearance.apply();
  }

  static async set(mode: string): Promise<void> {
    Appearance.mode = mode;
    Appearance.apply();
    if (Appearance.prefs) {
      await Appearance.prefs.put('colorMode', mode);
      await Appearance.prefs.flush();
    }
  }

  private static apply(): void {
    const app = Appearance.app;
    if (app === null) {
      return;
    }
    app.setColorMode(Appearance.mode === 'dark' ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
      : Appearance.mode === 'light' ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT
        : ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
  }
}
