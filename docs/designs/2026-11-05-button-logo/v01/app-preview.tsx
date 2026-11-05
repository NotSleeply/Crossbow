import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../../../../apps/desktop/src/App';
import {NotificationProvider} from '../../../../apps/desktop/src/notifications/NotificationProvider';
import '../../../../apps/desktop/src/index.css';
import '../../../../apps/desktop/src/Layout.css';
// The production logo is a CSS mask: recolour its brand token, not its image source.
const mode=new URLSearchParams(location.search).get('mode');
const style=document.createElement('style');
style.textContent=mode==='adaptive'?':root{--cb-brand:#293345}:root.dark{--cb-brand:#E7EAF2}':':root,:root.dark{--cb-brand:#293345}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<NotificationProvider><App/></NotificationProvider>);
