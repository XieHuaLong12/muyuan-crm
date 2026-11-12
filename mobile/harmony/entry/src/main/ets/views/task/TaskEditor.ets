import { Fmt } from '../../common/Format';
import { TASK_SOURCES, label } from '../../common/Labels';
import { Api } from '../../api/Http';
import { Repo } from '../../api/Repo';
import { TaskBody, TaskPatch, TaskRow } from '../../api/Models';
import { LvIcon } from '../../components/LvIcon';
import { Pill } from '../../components/Ui';

class Choice {
  key: string;
  title: string;

  constructor(key: string, title: string) {
    this.key = key;
    this.title = title;
  }
}

/** services/task-service.ts taskInput.type / priority. */
const TYPES: Choice[] = [
  new Choice('FOLLOW_UP', '跟进'), new Choice('QUOTATION', '报价'), new Choice('SAMPLE', '样品'),
  new Choice('PAYMENT', '付款'), new Choice('PRODUCTION', '生产'), new Choice('SHIPPING', '发货')
];
const PRIORITIES: Choice[] = [new Choice('HIGH', '高'), new Choice('MEDIUM', '中'), new Choice('LOW', '低')];

class DueOption {
  title: string;
  days: number;
  hour: number;

  constructor(title: string, days: number, hour: number) {
    this.title = title;
    this.days = days;
    this.hour = hour;
  }
}

const DUE_OPTIONS: DueOption[] = [
  new DueOption('今天 18:00', 0, 18), new DueOption('明天 10:00', 1, 10), new DueOption('3 天后', 3, 10),
  new DueOption('1 周后', 7, 10)
];
const HOURS: number[] = [9, 10, 14, 16, 18];

function atDayHour(day: Date, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
}

/**
 * New task (task === null) or one task's details: complete / reopen, reschedule, delete.
 * POST /api/tasks, PATCH /api/tasks/:id, DELETE /api/tasks/:id — the PC 任务 rules (scope, reminders) apply.
 */
@Component
export struct TaskEditor {
  @Prop customerId: string = '';
  @Prop customerName: string = '';
  @Prop task: TaskRow | null = null;
  onDone: () => void = () => {};
  onClose: () => void = () => {};
  @State title: string = '';
  @State note: string = '';
  @State type: string = 'FOLLOW_UP';
  @State priority: string = 'MEDIUM';
  @State due: number = 0;
  @State hour: number = 10;
  @State rescheduling: boolean = false;
  @State saving: boolean = false;
  @State error: string = '';

  aboutToAppear(): void {
    const start = Fmt.parse(Fmt.atDay(1, 10));
    this.due = start !== null ? start.getTime() : Date.now();
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
  }

  private pickQuick(option: DueOption): void {
    const d = new Date();
    d.setDate(d.getDate() + option.days);
    this.hour = option.hour;
    this.due = atDayHour(d, option.hour).getTime();
  }

  private pickDate(): void {
    this.getUIContext().showDatePickerDialog({
      start: new Date(),
      end: new Date(new Date().getFullYear() + 2, 11, 31),
      selected: new Date(this.due),
      onDateAccept: (value: Date) => {
        this.due = atDayHour(value, this.hour).getTime();
      }
    });
  }

  private pickHour(hour: number): void {
    this.hour = hour;
    this.due = atDayHour(new Date(this.due), hour).getTime();
  }

  private dueText(): string {
    const d = new Date(this.due);
    const days = Fmt.dayDiff(d);
    const day = days === 0 ? '今天' : days === 1 ? '明天' : `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    return `${day} ${Fmt.time(d)}`;
  }

  private async create(): Promise<void> {
    const title = this.title.trim();
    if (title.length === 0) {
      this.error = '请写一句要做什么';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const body: TaskBody = {
        customerId: this.customerId.length > 0 ? this.customerId : null, title: title, description: this.note.trim(),
        type: this.type, priority: this.priority, dueDate: new Date(this.due).toISOString()
      };
      await Repo.createTask(body);
      this.toast('任务已创建，会按时提醒');
      this.onDone();
    } catch (e) {
      this.error = Api.message(e);
    } finally {
      this.saving = false;
    }
  }

  private async patch(task: TaskRow, patch: TaskPatch, done: string): Promise<void> {
    this.saving = true;
    this.error = '';
    try {
      await Repo.updateTask(task.id, patch);
      this.toast(done);
      this.onDone();
    } catch (e) {
      this.error = Api.message(e);
    } finally {
      this.saving = false;
    }
  }

  private toggle(task: TaskRow): void {
    const patch: TaskPatch = { status: task.status === 'DONE' ? 'TODO' : 'DONE' };
    this.patch(task, patch, task.status === 'DONE' ? '已重新打开' : `已完成：${task.title}`);
  }

  private reschedule(task: TaskRow): void {
    const patch: TaskPatch = { dueDate: new Date(this.due).toISOString() };
    this.patch(task, patch, `已改到 ${this.dueText()}`);
  }

  private confirmDelete(task: TaskRow): void {
    this.getUIContext().showAlertDialog({
      title: '删除这条任务？',
      message: task.title,
      autoCancel: true,
      alignment: DialogAlignment.Center,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: {
        value: '删除',
        fontColor: $r('app.color.danger'),
        action: () => {
          this.remove(task);
        }
      }
    });
  }

  private async remove(task: TaskRow): Promise<void> {
    try {
      await Repo.deleteTask(task.id);
      this.toast('任务已删除');
      this.onDone();
    } catch (e) {
      this.error = Api.message(e);
    }
  }

  /** which: type | priority. The current choice is read here (not passed in), so the chips follow taps. */
  private chosen(which: string): string {
    return which === 'type' ? this.type : this.priority;
  }

  private choose(which: string, key: string): void {
    if (which === 'type') {
      this.type = key;
    } else {
      this.priority = key;
    }
  }

  @Builder
  chips(items: Choice[], which: string) {
    Flex({ wrap: FlexWrap.Wrap }) {
      ForEach(items, (c: Choice) => {
        Text(c.title)
          .fontSize(14)
          .fontColor(this.chosen(which) === c.key ? $r('app.color.on_brand') : $r('app.color.ink2'))
          .backgroundColor(this.chosen(which) === c.key ? $r('app.color.brand') : $r('app.color.surface2'))
          .borderRadius(17)
          .height(34)
          .padding({ left: 14, right: 14 })
          .margin({ right: 8, bottom: 8 })
          .onClick(() => this.choose(which, c.key))
      }, (c: Choice): string => c.key)
    }
  }

  @Builder
  duePicker() {
    Column({ space: 8 }) {
      Row() {
        Text('截止').fontSize(14).fontColor($r('app.color.ink2')).layoutWeight(1)
        Text(this.dueText()).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.brand_ink'))
      }
      .width('100%')
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(DUE_OPTIONS, (o: DueOption) => {
          Text(o.title)
            .fontSize(14).fontColor($r('app.color.ink2')).backgroundColor($r('app.color.surface2'))
            .borderRadius(17).height(34).padding({ left: 14, right: 14 }).margin({ right: 8, bottom: 8 })
            .onClick(() => this.pickQuick(o))
        }, (o: DueOption): string => o.title)
        Row({ space: 4 }) {
          LvIcon({ name: 'calendar-clock', iconColor: $r('app.color.brand_ink'), iconSize: 15 })
          Text('选日期').fontSize(14).fontColor($r('app.color.brand_ink'))
        }
        .borderRadius(17).height(34).padding({ left: 12, right: 14 }).margin({ right: 8, bottom: 8 })
        .backgroundColor($r('app.color.brand_soft'))
        .onClick(() => this.pickDate())
      }
      Row({ space: 6 }) {
        ForEach(HOURS, (h: number) => {
          Text(`${Fmt.pad(h)}:00`)
            .fontSize(13)
            .fontColor(this.hour === h ? $r('app.color.brand_ink') : $r('app.color.ink3'))
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .borderRadius(8)
            .border({ width: this.hour === h ? 1 : 0, color: $r('app.color.brand_ink') })
            .onClick(() => this.pickHour(h))
        }, (h: number): string => `${h}`)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  header(title: string) {
    Row() {
      Text(title).fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink')).layoutWeight(1)
      Row() {
        LvIcon({ name: 'x', iconColor: $r('app.color.ink2'), iconSize: 22 })
      }
      .width(40).height(40).justifyContent(FlexAlign.Center)
      .onClick(() => this.onClose())
    }
    .width('100%')
  }

  @Builder
  createForm() {
    Column({ space: 14 }) {
      this.header('新建任务')
      if (this.customerName.length > 0) {
        Text(`客户：${this.customerName}`).fontSize(14).fontColor($r('app.color.ink2'))
      }
      TextInput({ placeholder: '要做什么，例如：给客户发报价', text: this.title })
        .height(48).fontSize(16).backgroundColor($r('app.color.surface2'))
        .onChange((v: string) => {
          this.title = v;
          this.error = '';
        })
      TextArea({ placeholder: '补充说明（可选）', text: this.note })
        .height(80).fontSize(15).backgroundColor($r('app.color.surface2'))
        .onChange((v: string) => {
          this.note = v;
        })
      Text('类型').fontSize(14).fontColor($r('app.color.ink2'))
      this.chips(TYPES, 'type')
      Text('优先级').fontSize(14).fontColor($r('app.color.ink2'))
      this.chips(PRIORITIES, 'priority')
      this.duePicker()
      if (this.error.length > 0) {
        Text(this.error).fontSize(13).fontColor($r('app.color.danger'))
      }
      Button(this.saving ? '正在保存' : '创建任务')
        .type(ButtonType.Normal).width('100%').height(48).borderRadius(12)
        .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
        .enabled(!this.saving)
        .onClick(() => {
          this.create();
        })
    }
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  detail(t: TaskRow) {
    Column({ space: 14 }) {
      this.header('任务详情')
      Text(t.title).fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        .decoration({ type: t.status === 'DONE' ? TextDecorationType.LineThrough : TextDecorationType.None })
      Row({ space: 6 }) {
        Pill({ text: t.status === 'DONE' ? '已完成' : Fmt.due(t.dueDate).late ? '已逾期' : '进行中', tone: t.status === 'DONE' ? 'neutral' : Fmt.due(t.dueDate).late ? 'danger' : 'brand' })
        Pill({ text: label(TASK_SOURCES, t.source), tone: 'neutral' })
        if (t.priority === 'HIGH') {
          Pill({ text: '高优先级', tone: 'danger' })
        }
      }
      Row() {
        Text('截止').fontSize(14).fontColor($r('app.color.ink3')).width(56)
        Text(Fmt.due(t.dueDate).text).fontSize(15).fontColor(Fmt.due(t.dueDate).late && t.status !== 'DONE' ? $r('app.color.danger') : $r('app.color.ink'))
      }
      if (t.customer !== null) {
        Row() {
          Text('客户').fontSize(14).fontColor($r('app.color.ink3')).width(56)
          Text(`${t.customer.name}${t.customer.country.length > 0 ? ` · ${t.customer.country}` : ''}`).fontSize(15).fontColor($r('app.color.ink'))
        }
      }
      if (t.description.length > 0) {
        Text(t.description).fontSize(14).fontColor($r('app.color.ink2')).lineHeight(21).copyOption(CopyOptions.LocalDevice)
      }
      if (this.rescheduling) {
        this.duePicker()
        Button(this.saving ? '正在保存' : `改到 ${this.dueText()}`)
          .type(ButtonType.Normal).width('100%').height(46).borderRadius(12)
          .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
          .enabled(!this.saving)
          .onClick(() => this.reschedule(t))
      }
      if (this.error.length > 0) {
        Text(this.error).fontSize(13).fontColor($r('app.color.danger'))
      }
      Row({ space: 10 }) {
        Button('删除')
          .type(ButtonType.Normal).height(46).borderRadius(12).layoutWeight(1)
          .fontColor($r('app.color.danger')).backgroundColor($r('app.color.surface2'))
          .onClick(() => this.confirmDelete(t))
        if (t.status !== 'DONE') {
          Button('改期')
            .type(ButtonType.Normal).height(46).borderRadius(12).layoutWeight(1)
            .fontColor($r('app.color.ink')).backgroundColor($r('app.color.surface2'))
            .onClick(() => {
              this.rescheduling = !this.rescheduling;
            })
        }
        Button(t.status === 'DONE' ? '重新打开' : '完成')
          .type(ButtonType.Normal).height(46).borderRadius(12).layoutWeight(1)
          .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
          .enabled(!this.saving)
          .onClick(() => this.toggle(t))
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Scroll() {
      Column() {
        if (this.task === null) {
          this.createForm()
        } else {
          this.detail(this.task as TaskRow)
        }
      }
      .padding({ left: 16, right: 16, top: 4, bottom: 24 })
    }
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
    .width('100%')
    .height('100%')
  }
}
