import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ThemeDetailPage from './pages/ThemeDetailPage';
import MentionFilterPage from './pages/MentionFilterPage';
import CommentDetailPage from './pages/CommentDetailPage';
import StanceDetailPage from './pages/StanceDetailPage';
import Header from './components/Header';
import { markEnd } from './utils/perf';

const App: React.FC = () => {
  useEffect(() => {
    // Marks end of initial React render and DOM commit
    markEnd('app-bootstrap');
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/theme/:code" element={<ThemeDetailPage />} />
          <Route path="/theme/:code/stance/:stanceKey" element={<StanceDetailPage />} />
          <Route path="/mention/:mentionType/:mentionValue" element={<MentionFilterPage />} />
          <Route path="/comment/:id" element={<CommentDetailPage />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
