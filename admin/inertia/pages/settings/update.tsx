import { Head } from '@inertiajs/react'
import SettingsLayout from '~/layouts/SettingsLayout'
import StyledButton from '~/components/StyledButton'
import Input from '~/components/inputs/Input'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNotifications } from '~/context/NotificationContext'
import api from '~/lib/api'
import AppAutoUpdateSection from '~/components/updates/AppAutoUpdateSection'
import ContentAutoUpdateSection from '~/components/updates/ContentAutoUpdateSection'
import ContentUpdatesSection from '~/components/updates/ContentUpdatesSection'

export default function SystemUpdatePage() {
  const { addNotification } = useNotifications()
  const [email, setEmail] = useState('')

  const subscribeToReleaseNotesMutation = useMutation({
    mutationKey: ['subscribeToReleaseNotes'],
    mutationFn: (email: string) => api.subscribeToReleaseNotes(email),
    onSuccess: (data) => {
      if (data && data.success) {
        addNotification({ type: 'success', message: 'Successfully subscribed to release notes!' })
        setEmail('')
      } else {
        addNotification({
          type: 'error',
          message: `Failed to subscribe: ${data?.message || 'Unknown error'}`,
        })
      }
    },
    onError: (error: any) => {
      addNotification({
        type: 'error',
        message: `Error subscribing to release notes: ${error.message || 'Unknown error'}`,
      })
    },
  })

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
          <div className="bg-surface-primary rounded-lg border shadow-md overflow-hidden py-6 mt-12">
            <div className="flex flex-col md:flex-row justify-between items-center p-8 gap-y-8 md:gap-y-0 gap-x-8">
              <div>
                <h2 className="max-w-xl text-lg font-bold text-desert-green sm:text-xl lg:col-span-7">
                  Want to stay updated with the latest from Project NOMAD? Subscribe to receive
                  release notes directly to your inbox. Unsubscribe anytime.
                </h2>
              </div>
              <div className="flex flex-col">
                <div className="flex gap-x-3">
                  <Input
                    name="email"
                    label=""
                    type="email"
                    placeholder="Your email address"
                    disabled={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full"
                    containerClassName="!mt-0"
                  />
                  <StyledButton
                    variant="primary"
                    disabled={!email}
                    onClick={() => subscribeToReleaseNotesMutation.mutateAsync(email)}
                    loading={subscribeToReleaseNotesMutation.isPending}
                  >
                    Subscribe
                  </StyledButton>
                </div>
                <p className="mt-2 text-sm text-desert-stone-dark">
                  We care about your privacy. Project NOMAD will never share your email with third
                  parties or send you spam.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </SettingsLayout>
  )
}
