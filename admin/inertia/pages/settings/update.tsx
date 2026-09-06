import { Head } from '@inertiajs/react'
import SettingsLayout from '~/layouts/SettingsLayout'
import AppAutoUpdateSection from '~/components/updates/AppAutoUpdateSection'
import ContentAutoUpdateSection from '~/components/updates/ContentAutoUpdateSection'
import ContentUpdatesSection from '~/components/updates/ContentUpdatesSection'

export default function SystemUpdatePage() {
  return (
    <SettingsLayout>
      <Head title="System Update" />
      <div className="xl:pl-72 w-full">
        <main className="px-6 lg:px-12 py-6 lg:py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-desert-green mb-2">System Update</h1>
            <p className="text-desert-stone-dark">
              Keep your Project NOMAD apps and content up to date.
            </p>
          </div>

          <AppAutoUpdateSection />
          <ContentAutoUpdateSection />
          <ContentUpdatesSection />
        </main>
      </div>
    </SettingsLayout>
  )
}
