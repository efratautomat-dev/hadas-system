import { useState } from 'react'
import Login from './components/Login'
import Layout from './components/Layout'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  const handleLogin = (email: string) => {
    setUserEmail(email)
    setIsLoggedIn(true)
  }

  const handleLogout = () => {
    setIsLoggedIn(false)
    setUserEmail('')
  }

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />
  }

  return <Layout userEmail={userEmail} onLogout={handleLogout} />
}

export default App
