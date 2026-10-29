// Editable preview of the production component; all connection data is synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ipc, type LogEntry } from '../../../../apps/desktop/src/ipc';
import LogsPage from '../../../../apps/desktop/src/pages/Logs';
import '../../../../apps/desktop/src/index.css';
import './preview.css';
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const samples: LogEntry[] = Array.from({ length: 18 }, (_, i) => ({ type: i === 3 ? 'warning' : i === 6 ? 'error' : i === 9 ? 'debug' : 'info', payload: i === 3 ? 'Connection attempt timed out; retrying with the selected outbound.' : i === 6 ? 'DNS query failed for example.net: context deadline exceeded.' : i === 9 ? 'Controller received a health check request.' : `[TCP] 127.0.0.1:${60470+i}(${['Browser','Crossbow','Terminal'][i%3]}) --> ${['github.com:443','www.youtube.com:443','example.com:443'][i%3]} match ${i%3===2 ? 'GeoIP(cn)' : 'Match'} using ${i%3===2 ? 'DIRECT' : '节点选择[日本 · 东京 Hy2]'}` }));
ipc.onLogsStatus = async cb => { cb({ connected: true }); return () => {}; };
ipc.onCoreStatus = async cb => { cb({ state: 'Running' }); return () => {}; };
ipc.coreStatus = async () => ({ state: 'Running' });
ipc.onLogs = async cb => { setTimeout(() => cb(samples), 80); return () => {}; };
ipc.subscribeLogs = async () => {};
ipc.unsubscribeLogs = async () => {};
createRoot(document.getElementById('root')!).render(<><header className="mock-nav"><strong>Crossbow</strong><span>概览</span><span>节点</span><b>监测</b><span>配置</span><span>设置</span></header><main className="mock-panel"><nav className="mock-tabs"><span>连接</span><b>日志</b><span>诊断</span></nav><LogsPage /></main><footer>设计预览 · 示例日志 · v01</footer></>);
