'use client'

import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface AboutModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AboutModal({ open, onOpenChange }: AboutModalProps) {
  const creators = [
    {
      name: 'Zara Zhang',
      twitter: 'https://x.com/zarazhangrui',
      linkedin: 'https://linkedin.com/in/zarazhang',
    },
    {
      name: 'Yiqi Yan',
      twitter: 'https://x.com/placeholder2',
      linkedin: 'https://linkedin.com/in/placeholder2',
    },
    {
      name: 'Samuel Zhang',
      twitter: 'https://x.com/zhangsamuel12',
      linkedin: 'https://linkedin.com/in/samuelz12',
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm gap-0" showCloseButton={false}>
        <DialogHeader className="gap-0">
          <DialogTitle className="sr-only">About Us</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {creators.map((creator, index) => (
            <div key={index} className="flex items-center justify-between">
              <span className="font-medium text-gray-900">{creator.name}</span>
              <div className="flex gap-3 text-sm">
                <Link
                  href={creator.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-gray-900 transition-colors underline"
                  aria-label={`${creator.name}'s X`}
                >
                  X
                </Link>
                <Link
                  href={creator.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-gray-900 transition-colors underline"
                  aria-label={`${creator.name}'s LinkedIn`}
                >
                  LinkedIn
                </Link>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
