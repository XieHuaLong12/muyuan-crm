import { RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt } from '../common/Format';
import { TASK_SOURCES, label } from '../common/Labels';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { TaskListPage, TaskRow } from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { ListSource } from '../components/ListSource';
import { Pill, StateView } from '../components/Ui';

class TaskView {
  title: string;
  view: string;
  status: string;

  constructor(title: string, view: string, status: string) {
    this.title = title;
    this.view = view;
    this.status = status;
  }
}

/** The PC 任务 page filters (services/task-service.ts listTasks: view TODAY | OVERDUE, status OPEN | DONE). */
const VIEWS: TaskView[] = [
  new TaskView('今天', 'TODAY', 'OPEN'),
  new TaskView('已逾期', 'OVERDUE', ''),
  new TaskView('全部未完成', '', 'OPEN'),
  new TaskView('已完成', '', 'DONE')
];

/** 我的待办: every open task of my customers (administrators: everyone's), newest deadline first. */
@Component
export struct TasksPage {
  @Consume('pathStack') pathStack: NavPathStack;
  @State current: number = 0;
  @State state: string = 'loading';
  @State error: string = '';
  @State refreshing: boolean = false;
  @State count: number = 0;
  @State total: number = 0;
  private source: ListSource<TaskRow> = new ListSource<TaskRow>();

  aboutToAppear(): void {
    this.select(0);
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
  }

  private apply(page: TaskListPage): void {
    const rows = this.current === 3 ? page.tasks : page.tasks.filter((t: TaskRow): boolean => t.status !== 'DONE');
    this.source.reset(rows);
    this.count = rows.length;
    this.total = page.total;
  }

  private select(index: number): void {
    this.current = index;
    const v = VIEWS[index];
    const cached = Repo.peekTasks(v.view, v.status);
    if (cached !== null) {
      this.apply(cached);
      this.state = 'ready';
    } else {
      this.state = 'loading';
    }
    this.load();
  }

  private async load(): Promise<void> {
    const index = this.current;
    const v = VIEWS[index];
    try {
      const page = await Repo.tasks(v.view, v.status);
      if (index === this.current) {
        this.apply(page);
        this.state = 'ready';
      }
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      } else {
        this.toast(this.error);
      }
    } finally {
      this.refreshing = false;
    }
  }

  private async complete(task: TaskRow): Promise<void> {
    try {
      await Repo.completeTask(task.id);
      this.toast(`已完成：${task.title}`);
      AppStorage.setOrCreate<number>(StoreKeys.DATA_CHANGED, Date.now());
      this.load();
    } catch (e) {
      this.toast(Api.message(e));
    }
  }

  @Builder
  row(task: TaskRow) {
    Row({ space: 12 }) {
      if (task.status === 'DONE') {
        LvIcon({ name: 'circle-check', iconColor: $r('app.color.brand_ink'), iconSize: 24 })
      } else {
        Row()
          .width(24).height(24).borderRadius(12)
          .border({ width: 2, color: $r('app.color.ink3') })
          .onClick(() => {
            this.complete(task);
          })
      }
      Column({ space: 4 }) {
        Text(task.title).fontSize(15).fontColor(task.status === 'DONE' ? $r('app.color.ink3') : $r('app.color.ink'))
          .decoration({ type: task.status === 'DONE' ? TextDecorationType.LineThrough : TextDecorationType.None })
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (task.description.length > 0) {
          Text(task.description).fontSize(13).fontColor($r('app.color.ink2')).maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row({ space: 8 }) {
          Text(Fmt.due(task.dueDate).text)
            .fontSize(12)
            .fontColor(task.status !== 'DONE' && Fmt.due(task.dueDate).late ? $r('app.color.danger') : $r('app.color.ink3'))
          if (task.customer !== null) {
            Text(task.customer.name).fontSize(12).fontColor($r('app.color.brand_ink'))
          }
          Pill({ text: label(TASK_SOURCES, task.source), tone: 'neutral' })
          if (task.priority === 'HIGH') {
            Pill({ text: '高', tone: 'danger' })
          }
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .onClick(() => {
        if (task.customer !== null) {
          this.pathStack.pushPathByName(Routes.CUSTOMER, new RouteParam(task.customer.id));
        }
      })
    }
    .alignItems(VerticalAlign.Top)
    .width('100%')
    .padding(14)
    .borderRadius(16)
    .backgroundColor($r('app.color.surface'))
  }

  build() {
    NavDestination() {
      Column() {
        Scroll() {
          Row({ space: 8 }) {
            ForEach(VIEWS, (v: TaskView, index: number) => {
              Text(v.title)
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.current === index ? $r('app.color.on_brand') : $r('app.color.ink2'))
                .height(36)
                .padding({ left: 14, right: 14 })
                .borderRadius(18)
                .backgroundColor(this.current === index ? $r('app.color.brand') : $r('app.color.surface'))
                .onClick(() => {
                  if (index !== this.current) {
                    this.select(index);
                  }
                })
            }, (v: TaskView): string => v.title)
          }
          .padding({ left: 16, right: 16 })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
        .padding({ top: 8, bottom: 10 })

        if (this.state === 'loading') {
          StateView({ kind: 'loading' }).layoutWeight(1)
        } else if (this.state === 'error') {
          StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
            this.state = 'loading';
            this.load();
          } }).layoutWeight(1)
        } else {
          Refresh({ refreshing: $$this.refreshing }) {
            List({ space: 10 }) {
              ListItem() {
                Text(this.total > this.count ? `显示 ${this.count} / 共 ${this.total} 条` : `共 ${this.count} 条`)
                  .fontSize(12).fontColor($r('app.color.ink3')).padding({ left: 4 })
              }
              if (this.count === 0) {
                ListItem() {
                  StateView({ kind: 'empty', icon: 'list-todo', title: this.current === 3 ? '还没有完成的任务' : '这里没有待办', message: '跟进、首联和订单产生的待办会出现在这里。' })
                }
              }
              LazyForEach(this.source, (task: TaskRow) => {
                ListItem() {
                  this.row(task)
                }
              }, (task: TaskRow): string => `${this.source.generation}-${task.id}`)
            }
            .cachedCount(5)
            .padding({ left: 16, right: 16, bottom: 24 })
            .scrollBar(BarState.Off)
            .height('100%')
          }
          .onRefreshing(() => {
            this.load();
          })
          .layoutWeight(1)
        }
      }
      .width('100%')
      .height('100%')
    }
    .title('我的待办')
    .backgroundColor($r('app.color.bg'))
  }
}
