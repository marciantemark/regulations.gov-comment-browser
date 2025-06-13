import React from 'react';
import { Link } from 'react-router-dom';

const Header: React.FC = () => {
  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Comment Browser</h1>
              <p className="text-sm text-gray-500">Regulations.gov Analysis Portal</p>
            </div>
          </Link>
          
          <nav className="flex items-center space-x-6">
            <Link to="/" className="text-gray-700 hover:text-primary-600 font-medium">
              Themes
            </Link>
            <Link to="/search" className="text-gray-700 hover:text-primary-600 font-medium">
              Search
            </Link>
            <Link to="/analysis" className="text-gray-700 hover:text-primary-600 font-medium">
              Analysis
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
