'use client';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
export function Dialog({open,onClose,title,children,className=""}:{open:boolean;onClose:()=>void;title:string;children:React.ReactNode;className?:string}){return <D.Root open={open} onOpenChange={v=>{if(!v)onClose();}}><D.Portal><D.Overlay className="dialog-overlay"/><D.Content className={`dialog-content ${className}`} aria-describedby={undefined}><div className="dialog-head"><D.Title>{title}</D.Title><D.Close className="icon-button" aria-label="关闭"><X size={20}/></D.Close></div>{children}</D.Content></D.Portal></D.Root>;}
