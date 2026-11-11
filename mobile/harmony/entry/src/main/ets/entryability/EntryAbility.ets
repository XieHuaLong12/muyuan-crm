import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { Session } from '../api/Session';
import { Inbox } from '../api/Inbox';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'LVANJUBOS', 'ability created, reason %{public}d', launchParam.launchReason);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Restore the saved session and server address before the first page decides between login and the app.
    Session.init(this.context)
      .then((): Promise<void> => Inbox.init(this.context))
      .catch((e: BusinessError): void => hilog.error(0x0000, 'LVANJUBOS', 'session init failed: %{public}s', JSON.stringify(e)))
      .finally(() => {
        windowStage.loadContent('pages/Index', (err: BusinessError) => {
          if (err.code) {
            hilog.error(0x0000, 'LVANJUBOS', 'loadContent failed: %{public}s', JSON.stringify(err));
          }
        });
      });
  }
}
