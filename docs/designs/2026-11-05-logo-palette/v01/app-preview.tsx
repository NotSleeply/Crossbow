import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../../../../apps/desktop/src/App';
import {NotificationProvider} from '../../../../apps/desktop/src/notifications/NotificationProvider';
import '../../../../apps/desktop/src/index.css';
import '../../../../apps/desktop/src/Layout.css';
createRoot(document.getElementById('root')!).render(<NotificationProvider><App/></NotificationProvider>);
