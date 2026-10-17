# AutoGrade.ai

## Auth Model

- Protected endpoints require header: `Authorization: Bearer <authToken>`
- You can get `authToken` from:
1. `POST /api/auth/login`
2. `POST /api/auth/signup`
3. Google OAuth callback redirect query (`?accessToken=...`)

## Route List (Frontend Reference)

### Public Routes

1. `GET /`
Purpose: Root welcome text.

2. `GET /health`
Purpose: Health check plus Google OAuth config snapshot.

3. `GET /test`
Purpose: Backend-served HTML test console.

### Auth Routes

1. `POST /api/auth/login`
Body:
```json
{
  "email": "teacher@example.com",
  "fullName": "Teacher Name"
}
```
Purpose: Local login with auto-signup fallback.

2. `POST /api/auth/signup`
Body:
```json
{
  "email": "teacher@example.com",
  "fullName": "Teacher Name"
}
```
Purpose: Local account creation.

3. `GET /api/auth/google`
Purpose: Start Google OAuth login.

4. `GET /api/auth/google/signup`
Purpose: Start Google OAuth signup flow.

5. `GET /api/auth/google/callback`
Purpose: OAuth callback endpoint. Frontend usually does not call this directly.

### User Routes (Protected)

1. `GET /api/user`
Purpose: Current authenticated user profile.

2. `GET /api/user/wallet/balance`
Purpose: Return the current wallet balance for the authenticated user.

### Classroom Routes (Protected)

1. `GET /api/classroom/courses`
Purpose: List active Google Classroom courses.
Query (optional): `pageSize`

2. `GET /api/classroom/coursework/notCreated/:courseId`
Purpose: Return only coursework whose `courseWorkId` does NOT exist in the database yet for the current user and course.
Query (optional): `orderBy`, `courseWorkStates`, `previewVersion`

3. `GET /api/classroom/coursework/created/:courseId`
Purpose: Return only coursework whose `courseWorkId` already exists in the database for the current user and course.
Query (optional): `orderBy`, `courseWorkStates`, `previewVersion`

4. `POST /api/classroom/createCoursework/:courseId`
Purpose: Create a Classroom assignment from an uploaded file and return `courseworkId` plus `driveId`.
Content-Type: `multipart/form-data`
Form fields:
- `file` required
- `title`
- `description`
- `maxPoints`
- `dueDate`
- `dueTime` optional (`HH:mm` or `HH:mm:ss`)

Notes:
- If `dueDate` is provided and `dueTime` is omitted, backend defaults to `23:59:00`.
- `maxPoints` is normalized to a number before sending to Google Classroom.

5. `POST /api/classroom/coursework/:courseId/:courseWorkId/submissions`
Purpose: Start background grading for submitted coursework.
Path params: `courseId`, `courseWorkId`
Content-Type: `multipart/form-data`
Form fields:
- `driveId`
- `rubricContext`
- `strictness` (`Easy` | `Medium` | `Hard`)
- `maxScore`
- `file` optional reference material
Response: queued job metadata including `jobId`, `requestId`, `statusEndpoint`.

Quota + Resume Notes:
- Free tier is enforced per account (default: `FREE_COPIES_PER_ACCOUNT=5`).
- If the request exceeds the remaining free quota, the extra copies are billed from wallet balance.
- If wallet balance is insufficient for the paid portion, API returns `402` and asks user to recharge first.
- Recheck is resume-safe: already graded attachments are skipped; only pending attachments are processed.
- Response includes billing details: `freeCopiesLimit`, `usedFreeCopies`, `remainingFreeCopies`, `consumedFreeCopies`, `paidCopiesToConsume`, `paidCopyCostInr`, `requiredWalletInr`, `walletBalanceInr`.
- If no pending attachments are found, API returns `400`.

6. `GET /api/classroom/coursework/:courseId/:courseWorkId/submissions/jobs/:jobId`
Purpose: Poll background grading job status and result.
Response fields include:
- `state`, `progress`, `attemptsMade`
- `result`, `error`
- `requestId`, `createdAt`, `processedAt`, `finishedAt`

7. `GET /api/classroom/dashboard/:courseId/:courseWorkId`
Purpose: Fetch saved grading results for dashboard use.
Response includes:
- `results` saved grading rows
- `summary` with progress counters:
	- `totalStudents`, `completedStudents`, `remainingStudents`
	- `totalCopies`, `completedCopies`, `failedCopies`, `remainingCopies`

8. `PATCH /api/classroom/coursework/:courseId/:courseWorkId/submissions/marks`
Purpose: Sync stored scores back to Google Classroom student submissions.

### Drive Routes (Protected)

1. `GET /api/drive/download/:fileId`
Purpose: Download a Drive file to temp storage for verification.

2. `GET /api/drive/process/:fileId`
Purpose: End-to-end Drive -> GCS -> OCR flow for verification.

3. `GET /api/drive/gcs/test`
Purpose: GCS upload smoke test.

4. `POST /api/drive/extract/local`
Purpose: OCR/text extraction from a local upload.
Content-Type: `multipart/form-data`
Form field: `file`

5. `POST /api/drive/upload/local`
Purpose: Upload a local file to Google Drive and return `driveId`.
Content-Type: `multipart/form-data`
Form fields:
- `file` required
- `fileName` optional
- `folderId` optional

### Payment Routes
1. `POST /api/payments/razorpay/order` (Protected)
Purpose: Create a Razorpay order for either a wallet recharge or a usage-based charge.
Recommended frontend flow: send `rechargeAmountInr` to top up wallet.
Body fields:
- `rechargeAmountInr` for wallet recharge orders, minimum `100`
- Or the same usage fields used by internal usage billing flows
Optional header:
- `x-idempotency-key` (recommended) to safely retry without creating duplicate orders.
Behavior:
- If the same `x-idempotency-key` is reused for the same user, API returns the existing order instead of creating a new one.
- Recharge orders are marked as `wallet_recharge` and are credited to the user wallet after `payment.captured`.
- Profit margin is fixed at **30%** server-side and cannot be overridden by the client. To change, set `BILLING_PROFIT_MARGIN_PERCENT` env var.

2. `POST /api/payments/razorpay/verify` (Protected)
Purpose: **Verify payment and credit wallet** after user completes Razorpay checkout on the frontend.
Body:
```json
{
  "razorpay_order_id": "order_xxxxx",
  "razorpay_payment_id": "pay_xxxxx",
  "razorpay_signature": "hex_signature"
}
```
Behavior:
- Verifies the Razorpay payment signature (HMAC of `order_id|payment_id` with key secret).
- Credits the payment amount to the user's wallet balance.
- Marks the payment order as `paid`.
- Idempotent: calling again for an already-paid order returns success without double-crediting.
Response (success):
```json
{
  "message": "Payment verified and wallet updated.",
  "orderId": "order_xxxxx",
  "paymentId": "pay_xxxxx",
  "status": "paid",
  "amountInr": 500,
  "walletBalanceInr": 500
}
```

3. `POST /api/payments/razorpay/webhook` (Public, Razorpay only)
Purpose: Process payment success/failure events from Razorpay (backup/async).
Security:
- Verifies `x-razorpay-signature`.
- Deduplicates events using `x-razorpay-event-id` (replay protection).
- Ignores duplicate `payment.captured` for already-paid orders.
- Credits wallet balance for successful payment orders.

Observability:
- Structured payment logs are emitted for order creation/webhook success/failure.
- Optional alerting via `ALERT_WEBHOOK_URL`.

## Production Readiness Notes

### Critical Fixes Applied
- CourseWork schema mismatch resolved: `createCoursework` now stores `maxScore`, `strictness`, and `rubricContext` defaults to prevent database validation errors.
- Route naming normalized: `/coursework/created/:courseId` now returns stored coursework; `/coursework/notCreated/:courseId` returns un-synced coursework.
- Wallet-based billing added: users can recharge a wallet balance and grading debits wallet usage automatically instead of requiring manual spend inputs.
- **Profit margin locked server-side**: Fixed at 30% (configurable via `BILLING_PROFIT_MARGIN_PERCENT` env var). Clients cannot override profit margin.

### Recommended Before Production
1. **Gate Test-Only Drive Endpoints**: Routes `/api/drive/download/:fileId`, `/api/drive/process/:fileId`, `/api/drive/gcs/test`, `/api/drive/extract/local` are test utilities. Either remove them or gate behind `NODE_ENV !== 'production'` check.
2. **Security Middleware Added**: `helmet` and `express-rate-limit` are now applied across auth/payment/grading routes. Tune limits per traffic profile.
3. **Payment Replay + Idempotency Added**: webhook replay protection and duplicate capture handling are implemented; clients should send `x-idempotency-key` for order creation retries.
4. **Review Auto-Signup**: The `/api/auth/login` endpoint auto-creates users if not found. Ensure this matches your intended onboarding flow.
5. **Observability Alerts**: set `ALERT_WEBHOOK_URL` to receive payment failure/webhook processing failure alerts.
6. **Wallet Billing Behavior**: grading now consumes wallet balance automatically during processing; if the wallet is low, users should recharge first.
7. **Resume Behavior**: grading resumes only when user triggers submissions endpoint again; payment capture does not auto-start grading.

## Quick Frontend Usage Pattern

1. Login/signup to obtain `authToken`.
2. Store token in memory/localStorage.
3. Add `Authorization: Bearer <token>` to protected requests.
4. Check wallet balance with `GET /api/user/wallet/balance` before starting a grading job.
5. Recharge wallet with `POST /api/payments/razorpay/order` using `rechargeAmountInr`, then open Razorpay checkout.
6. **After checkout success, call `POST /api/payments/razorpay/verify`** with `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` to verify payment and credit wallet.
7. For long-running grading, call submissions route once, then poll job status route.

## Minimal Fetch Example

```js
const BASE = import.meta.env.VITE_BACKEND_URL;

async function login(email, fullName) {
	const res = await fetch(`${BASE}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, fullName }),
	});
	return res.json();
}

async function getUser(token) {
	const res = await fetch(`${BASE}/api/user`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	return res.json();
}
```

