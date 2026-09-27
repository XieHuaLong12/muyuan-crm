export const KANBAN_STAGES=[
 {key:'NEW',label:'新线索'},
 {key:'CONTACTED',label:'已联系'},
 {key:'REPLIED',label:'已回复'},
 {key:'NEEDS_CONFIRMED',label:'已确认产品'},
 {key:'QUOTED',label:'已报价'},
 {key:'FOLLOW_UP',label:'谈判 / 跟进'},
 {key:'ORDER',label:'确认采购'},
 {key:'WON',label:'成交'},
 {key:'PAUSED',label:'暂不需要'},
] as const;
export type KanbanStage=typeof KANBAN_STAGES[number]['key'];
