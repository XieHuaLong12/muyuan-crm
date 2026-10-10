import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Search as SearchIcon } from 'lucide-react';

export function Typography({as:Tag='p',variant='body',className='',...props}:{as?:'h1'|'h2'|'h3'|'p'|'span';variant?:'display'|'heading'|'body'|'table'|'caption'}&HTMLAttributes<HTMLElement>){return <Tag className={`bos-type-${variant} ${className}`} {...props}/>;}
export function Button({variant='secondary',className='',type='button',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'ghost'}){return <button type={type} className={`bos-button bos-button-${variant} ${className}`} {...props}/>;}
export function Card({className='',...props}:HTMLAttributes<HTMLElement>){return <section className={`bos-card ${className}`} {...props}/>;}
export function Input({className='',...props}:InputHTMLAttributes<HTMLInputElement>){return <input className={`bos-input ${className}`} {...props}/>;}
export function Search({label='搜索',...props}:InputHTMLAttributes<HTMLInputElement>&{label?:string}){return <label className="bos-search"><SearchIcon size={17} aria-hidden/><Input type="search" aria-label={label} {...props}/></label>;}
export function Badge({tone='neutral',children}:{tone?:'neutral'|'green'|'warning';children:ReactNode}){return <span className={`bos-badge bos-badge-${tone}`}>{children}</span>;}
export function Table({caption,headings,children}:{caption:string;headings:string[];children:ReactNode}){return <div className="bos-table-scroll"><table className="bos-table"><caption className="bos-sr-only">{caption}</caption><thead><tr>{headings.map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
export function Header({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}){return <header className="bos-page-header"><div>{eyebrow&&<span className="bos-eyebrow">{eyebrow}</span>}<Typography as="h1" variant="display">{title}</Typography>{description&&<p>{description}</p>}</div>{actions&&<div className="bos-actions">{actions}</div>}</header>;}
export function EmptyState({title,description,action}:{title:string;description:string;action?:ReactNode}){return <div className="bos-empty"><span className="bos-empty-mark" aria-hidden>↗</span><h3>{title}</h3><p>{description}</p>{action}</div>;}
export function Skeleton(){return <div className="bos-skeleton" role="status" aria-label="加载工作空间"><div/><div/><div/></div>;}
