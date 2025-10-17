'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { User } from '@supabase/supabase-js'
import { Loader2, Zap, Brain } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { toast } from 'sonner'
import type { TopicGenerationMode } from '@/lib/types'

interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
  free_generations_used: number
  topic_generation_mode: TopicGenerationMode | null
}

interface SettingsFormProps {
  user: User
  profile: Profile | null
  videoCount: number
}

const MODE_CARDS: Record<TopicGenerationMode, {
  title: string
  icon: React.ComponentType<{ className?: string }>
}> = {
  smart: {
    title: 'Smart',
    icon: Brain
  },
  fast: {
    title: 'Fast',
    icon: Zap
  }
}

export default function SettingsForm({ user, profile, videoCount }: SettingsFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [topicGenerationMode, setTopicGenerationMode] = useState<TopicGenerationMode>(
    profile?.topic_generation_mode ?? 'smart'
  )

  const [loading, setLoading] = useState(false)

  const hasProfileChanges = useMemo(() => {
    return (
      fullName !== (profile?.full_name || '') ||
      topicGenerationMode !== (profile?.topic_generation_mode ?? 'smart')
    )
  }, [fullName, profile?.full_name, profile?.topic_generation_mode, topicGenerationMode])

  const handleUpdateProfile = async () => {
    if (!hasProfileChanges) {
      return
    }

    setLoading(true)

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        topic_generation_mode: topicGenerationMode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Settings updated successfully!')
      router.refresh()
    }

    setLoading(false)
  }

  const handleUpdatePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Password updated successfully!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }

    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Profile Information</CardTitle>
          <CardDescription className="text-sm">Update your personal information and preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={user.email}
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="topic-mode" className="text-sm font-medium">Topic Generation Mode</Label>
            <Select
              value={topicGenerationMode}
              onValueChange={(value) => setTopicGenerationMode(value as TopicGenerationMode)}
            >
              <SelectTrigger id="topic-mode" className="w-[200px]">
                <SelectValue>
                  {(() => {
                    const config = MODE_CARDS[topicGenerationMode]
                    const Icon = config.icon
                    return (
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span>{config.title}</span>
                      </div>
                    )
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODE_CARDS).map(([value, config]) => {
                  const Icon = config.icon
                  return (
                    <SelectItem key={value} value={value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span>{config.title}</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end bg-muted/30">
          <Button 
            onClick={handleUpdateProfile} 
            disabled={loading || !hasProfileChanges}
            size="default"
            className="min-w-[120px]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </CardFooter>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Change Password</CardTitle>
          <CardDescription className="text-sm">Update your password to keep your account secure</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end bg-muted/30">
          <Button
            onClick={handleUpdatePassword}
            disabled={loading || !newPassword || !confirmPassword}
            size="default"
            className="min-w-[120px]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              'Update Password'
            )}
          </Button>
        </CardFooter>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Account Statistics</CardTitle>
          <CardDescription className="text-sm">Your usage information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Account Created</span>
              <span className="text-sm font-semibold">
                {new Date(profile?.created_at || user.created_at).toLocaleDateString()}
              </span>
            </div>
            <Separator className="bg-border/50" />
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Videos Analyzed</span>
              <span className="text-sm font-semibold">
                {videoCount} {videoCount === 1 ? 'video' : 'videos'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

