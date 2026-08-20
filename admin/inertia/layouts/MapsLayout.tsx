import Footer from '~/components/Footer'

export default function MapsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 w-full bg-desert">{children}</div>
      <Footer />
    </div>
  )
}
