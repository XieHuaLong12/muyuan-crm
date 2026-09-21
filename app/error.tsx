'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="v3-error-page"><h1>暂时无法打开工作台</h1><p>请重试，已保存的客户和任务不会受到影响。</p><button className="primary" onClick={reset}>重新加载</button></main>;}
