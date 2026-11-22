import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ClassProvider } from '../context/ClassContext.jsx';
import Classes from './Classes.jsx';
import '../styles/base.css';
function Fixture(){const [account,setAccount]=useState('a');window.__switchAccount=setAccount;
 window.__setYear=year=>{window.__year=year;window.dispatchEvent(new Event('fixture-year'));};
 return <MemoryRouter><ClassProvider user={{id:account,organisationId:account}}><Classes /></ClassProvider></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
