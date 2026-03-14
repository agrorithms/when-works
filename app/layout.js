import './globals.css'

export const metadata = {
  title: 'When Works',
  description: 'Find the best day for everyone to hang out!',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
