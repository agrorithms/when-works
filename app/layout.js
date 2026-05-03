import './globals.css'
import AppSessionProvider from '../components/SessionProvider'

export const metadata = {
  title: 'When Works',
  description: 'Find the best day for everyone to hang out!',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppSessionProvider>{children}</AppSessionProvider>
      </body>
    </html>
  )
}
