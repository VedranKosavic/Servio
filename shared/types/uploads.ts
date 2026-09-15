/** What `POST /api/uploads` answers with — a delivery photo, stored and sized. */
export interface UploadResult {
  id: string
  url: string
  width: number
  height: number
  bytes: number
}
