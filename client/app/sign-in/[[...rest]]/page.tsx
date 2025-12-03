import { SignIn } from "@clerk/nextjs";
//signin page
export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <SignIn forceRedirectUrl="/career-guidance-home" />

    </div>
  );
}
