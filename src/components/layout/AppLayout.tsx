import { Sidebar } from './Sidebar'
import { Outlet } from 'react-router-dom'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      {/* Main content - offset for sidebar width */}
      <main className="flex-1 mr-16 md:mr-56 min-h-screen overflow-auto">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
