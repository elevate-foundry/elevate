import { useEffect } from 'react';
import { useAppStore } from './store';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { MainPanel } from './components/Layout/MainPanel';
import { Tooltip } from './components/shared/Tooltip';
import './App.css';

export default function App() {
  const init = useAppStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <>
      <Header />
      <div className="main">
        <Sidebar />
        <MainPanel />
      </div>
      <Tooltip />
    </>
  );
}
