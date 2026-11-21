// Synthetic browser entry only; never imported by the application.
import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import Header from './Header';
import {createServerAuthController} from '../utils/serverAuthController';
import '../styles/base.css';
import '../styles/accessibility.css';
function Fixture(){
  const [user,setUser]=useState(null);
  const [controller]=useState(()=>createServerAuthController());
  useEffect(()=>{
    window.__browserResetVerify=async()=>{
      const result=await controller.restoreSession();
      if(result.state==='authenticated')setUser(result.user);
      return result.state;
    };
    window.__browserResetFixtureReady=true;
    return ()=>{delete window.__browserResetVerify;};
  },[controller]);
  useEffect(()=>{if(user)controller.activateDisplayedSession(user.id);},[user,controller]);
  const login=async input=>{
    window.__browserResetLoginTerminal=null;
    try {
      const result=await controller.login(input);
      setUser(result);window.__browserResetLoginTerminal='authenticated';return result;
    } catch(error) {
      window.__browserResetLoginTerminal='failed';throw error;
    }
  };
  return <BrowserRouter><Header user={user} isAuthLoading={false} onLogin={login} onSignup={async()=>{}} onLogout={async()=>{}}/>
    <main><h1>Synthetic browser reset fixture</h1></main></BrowserRouter>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
