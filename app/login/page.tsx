import AuthForm from "@/components/AuthForm";

export const metadata = { title: "Log in · WhoDoesWhat" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
