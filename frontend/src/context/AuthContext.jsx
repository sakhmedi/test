import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [companyId, setCompanyId] = useState(() => localStorage.getItem('companyId'));

  function login(accessToken, cid) {
    localStorage.setItem('token', accessToken);
    if (cid) localStorage.setItem('companyId', cid);
    setToken(accessToken);
    setCompanyId(cid || null);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('companyId');
    setToken(null);
    setCompanyId(null);
  }

  return (
    <AuthContext.Provider value={{ token, companyId, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
