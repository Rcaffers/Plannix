import { createBrowserRouter } from 'react-router-dom';
import App from './App';

export function createPlannixRouter() {
  return createBrowserRouter([{ path: '*', element: <App /> }]);
}
