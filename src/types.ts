export type View = 'dashboard' | 'opportunities' | 'applications' | 'profile' | 'documents'

export type ApplicationStatus = 'Draft' | 'Ready' | 'Submitted' | 'Interview'

export interface Application {
  id: string
  title: string
  organization: string
  type: string
  deadline: string
  deadlineLabel: string
  status: ApplicationStatus
  tone: 'blue' | 'orange' | 'green'
}

export interface ProfileData {
  name: string
  headline: string
  email: string
  university: string
  graduation: string
  linkedIn: string
  github: string
}
