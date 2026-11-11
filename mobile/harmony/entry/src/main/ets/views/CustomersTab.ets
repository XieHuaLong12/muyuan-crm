import { RouteParam, Routes } from '../common/Config';
import { Fmt } from '../common/Format';
import { STAGES, label, stageTone } from '../common/Labels';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { ListCustomerRow, QueueCount, QueueCustomer } from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { Avatar, Pill, StateView } from '../components/Ui';

class QueueDef {
  key: string;
  title: string;
  adminOnly: boolean;

  constructor(key: string, title: string, adminOnly: boolean = false) {
    this.key = key;
    this.title = title;
    this.adminOnly = adminOnly;
  }
}

/** One row of the list, whichever endpoint it came from. */
class CustomerItem {
  id: string = '';
  name: string = '';
  company: string = '';
  country: string = '';
  stage: string = '';
  grade: string = '';
  note: string = '';
  dueText: string = '';
  dueLate: boolean = false;
  dueSoon: boolean = false;
  firstContact: boolean = false;
}

/** Queues defined once on the server (services/bos-sales-service.ts queueFilters); 待分配 is the assignment pool. */
const QUEUES: QueueDef[] = [
  new QueueDef('pool', '待分配', true),
  new QueueDef('today', '今日跟进'),
  new QueueDef('new', '待首联'),
  new QueueDef('waiting', '等我回复'),
  new QueueDef('high', '高意向'),
  new QueueDef('recent', '全部')
];

function fromQueue(c: QueueCustomer): CustomerItem {
  const item = new CustomerItem();
  item.id = c.id;
  item.name = c.name;
  item.company = c.companyName;
  item.country = c.country;
  item.stage = c.stage;
  item.grade = c.leadGrade;
  item.note = c.reasons.length > 0 ? c.reasons.join(' · ') : c.leadGradeReason;
  const pendingFirst = c.firstContactDueAt !== null && c.firstContactAt === null;
  const due = Fmt.due(pendingFirst ? c.firstContactDueAt : c.nextFollowUpAt);
  item.firstContact = pendingFirst;
  item.dueText = pendingFirst || c.nextFollowUpAt !== null ? due.text : '';
  item.dueLate = due.late;
  item.dueSoon = due.soon;
  return item;
}

function fromList(c: ListCustomerRow): CustomerItem {
  const item = new CustomerItem();
  item.id = c.id;
  item.name = c.name;
  item.company = c.companyName;
  item.country = c.country;
  item.stage = c.stage;
  item.grade = c.leadGrade;
  item.note = c.leadGradeReason.length > 0 ? c.leadGradeReason : `进线 ${Fmt.ago(c.inquiryAt !== null ? c.inquiryAt : c.createdAt)}`;
  return item;
}

@Component
export struct CustomersTab {
  @Consume('pathStack') pathStack: NavPathStack;
  @StorageLink('customersQueue') @Watch('onQueueRequested') requested: string = '';
  @State queue: string = Session.isAdmin() ? 'recent' : 'today';
  @State items: CustomerItem[] = [];
  @State counts: QueueCount[] = [];
  @State total: number = 0;
  @State page: number = 1;
  @State keyword: string = '';
  @State state: string = 'loading';
  @State error: string = '';
  @State refreshing: boolean = false;
  @State loadingMore: boolean = false;
  @State poolCount: number = 0;
  private searchTimer: number = -1;

  aboutToAppear(): void {
    if (this.requested.length > 0) {
      this.queue = this.requested;
      this.requested = '';
    }
    this.load(true);
  }

  /** The home tab asked for a queue (e.g. tapping 「待首联」). */
  onQueueRequested(): void {
    if (this.requested.length > 0) {
      this.queue = this.requested;
      this.requested = '';
      this.state = 'loading';
      this.load(true);
    }
  }

  private async load(reset: boolean): Promise<void> {
    const page = reset ? 1 : this.page + 1;
    try {
      if (this.queue === 'pool') {
        const result = await Repo.pool(this.keyword);
        this.items = result.rows.map(fromList);
        this.total = result.total;
        this.poolCount = result.pool;
      } else {
        const result = await Repo.queue(this.queue, this.keyword, page);
        const rows = result.customers.map(fromQueue);
        this.items = reset ? rows : this.items.concat(rows);
        this.total = result.total;
        this.counts = result.counts;
      }
      this.page = page;
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      if (reset) {
        this.state = 'error';
      }
    } finally {
      this.refreshing = false;
      this.loadingMore = false;
    }
  }

  private countOf(key: string): number {
    if (key === 'pool') return this.poolCount;
    const found = this.counts.find((c: QueueCount): boolean => c.key === key);
    return found === undefined ? -1 : found.count;
  }

  private select(key: string): void {
    if (key === this.queue) return;
    this.queue = key;
    this.state = 'loading';
    this.load(true);
  }

  private onSearch(value: string): void {
    this.keyword = value.trim();
    if (this.searchTimer !== -1) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.state = 'loading';
      this.load(true);
    }, 400);
  }

  private visibleQueues(): QueueDef[] {
    const admin = Session.isAdmin();
    return QUEUES.filter((q: QueueDef): boolean => admin || !q.adminOnly);
  }

  @Builder
  chip(q: QueueDef) {
    Row({ space: 6 }) {
      Text(q.title)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.queue === q.key ? $r('app.color.on_brand') : $r('app.color.ink2'))
      if (this.countOf(q.key) >= 0 && q.key !== 'recent') {
        Text(`${this.countOf(q.key)}`)
          .fontSize(12)
          .fontColor(this.queue === q.key ? $r('app.color.on_brand') : (q.key === 'new' || q.key === 'waiting' || q.key === 'pool') && this.countOf(q.key) > 0 ? $r('app.color.danger') : $r('app.color.ink3'))
      }
    }
    .height(36)
    .padding({ left: 14, right: 14 })
    .borderRadius(18)
    .backgroundColor(this.queue === q.key ? $r('app.color.brand') : $r('app.color.surface'))
    .border({ width: this.queue === q.key ? 0 : 1, color: $r('app.color.line') })
    .onClick(() => this.select(q.key))
  }

  @Builder
  card(item: CustomerItem) {
    Column({ space: 8 }) {
      Row({ space: 12 }) {
        Avatar({ name: item.name, grade: item.grade })
        Column({ space: 3 }) {
          Text(item.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(`${item.company.length > 0 ? `${item.company} · ` : ''}${item.country}`)
            .fontSize(13).fontColor($r('app.color.ink3')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 6 }) {
            Pill({ text: label(STAGES, item.stage), tone: stageTone(item.stage) })
          }
          .margin({ top: 2 })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        LvIcon({ name: 'chevron-right', iconColor: $r('app.color.ink3'), iconSize: 18 })
      }
      .width('100%')

      if (item.dueText.length > 0 || item.note.length > 0) {
        Row({ space: 10 }) {
          if (item.dueText.length > 0) {
            Row({ space: 4 }) {
              LvIcon({ name: item.firstContact ? 'timer' : 'alarm-clock', iconColor: item.dueLate ? $r('app.color.danger') : item.dueSoon ? $r('app.color.warning') : $r('app.color.ink3'), iconSize: 14 })
              Text(`${item.firstContact ? '首联 ' : ''}${item.dueText}`)
                .fontSize(12)
                .fontWeight(item.dueLate || item.dueSoon ? FontWeight.Medium : FontWeight.Normal)
                .fontColor(item.dueLate ? $r('app.color.danger') : item.dueSoon ? $r('app.color.warning') : $r('app.color.ink3'))
            }
          }
          if (item.note.length > 0) {
            Text(item.note).fontSize(12).fontColor($r('app.color.ink3')).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
          }
        }
        .width('100%')
        .padding({ top: 8 })
        .border({ width: { top: 0.5 }, color: $r('app.color.line_soft') })
      }
    }
    .padding(14)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
    .border({ width: 0.5, color: $r('app.color.line_soft') })
    .onClick(() => {
      this.pathStack.pushPathByName(Routes.CUSTOMER, new RouteParam(item.id));
    })
  }

  build() {
    Column() {
      Column({ space: 10 }) {
        Column({ space: 2 }) {
          Text('客户').fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
          Text(Session.isAdmin() ? '全公司客户 · 队列与电脑端「跟进队列」一致' : '我负责的客户').fontSize(13).fontColor($r('app.color.ink3'))
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding({ left: 16, right: 16, top: 16 })

        Search({ value: this.keyword, placeholder: '姓名、公司、国家、WhatsApp' })
          .height(44)
          .margin({ left: 16, right: 16 })
          .backgroundColor($r('app.color.surface2'))
          .onChange((value: string): void => this.onSearch(value))

        Scroll() {
          Row({ space: 8 }) {
            ForEach(this.visibleQueues(), (q: QueueDef) => {
              this.chip(q)
            }, (q: QueueDef): string => q.key)
          }
          .padding({ left: 16, right: 16 })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
      }
      .padding({ bottom: 10 })
      .backgroundColor($r('app.color.bg'))

      if (this.state === 'loading') {
        StateView({ kind: 'loading' }).layoutWeight(1)
      } else if (this.state === 'error') {
        StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
          this.state = 'loading';
          this.load(true);
        } }).layoutWeight(1)
      } else {
        Refresh({ refreshing: $$this.refreshing }) {
          List({ space: 10 }) {
            ListItem() {
              Text(`共 ${this.total} 位`).fontSize(12).fontColor($r('app.color.ink3')).padding({ left: 4 })
            }

            if (this.items.length === 0) {
              ListItem() {
                StateView({
                  kind: 'empty', icon: 'users',
                  title: this.keyword.length > 0 ? `没有找到「${this.keyword}」` : '这个队列里没有客户',
                  message: this.keyword.length > 0 ? '换个关键词，或切换到「全部」再搜索。' : '有新的待办时会出现在这里。'
                })
              }
            }

            ForEach(this.items, (item: CustomerItem) => {
              ListItem() {
                this.card(item)
              }
            }, (item: CustomerItem): string => item.id)

            if (this.queue !== 'pool' && this.items.length < this.total) {
              ListItem() {
                Button(this.loadingMore ? '加载中' : '加载更多')
                  .type(ButtonType.Normal).borderRadius(12).height(44).width('100%')
                  .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.surface'))
                  .enabled(!this.loadingMore)
                  .onClick(() => {
                    this.loadingMore = true;
                    this.load(false);
                  })
              }
            }
          }
          .padding({ left: 16, right: 16, bottom: 24 })
          .scrollBar(BarState.Off)
          .height('100%')
        }
        .onRefreshing(() => {
          this.load(true);
        })
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
  }
}
