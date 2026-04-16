import AuthForm from '../../components/AuthForm';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-900">Sign in</h1>
          <p className="mt-3 text-slate-600">Welcome to Bside — rate albums and build your music catalog.</p>
        </div>
        <div className="mt-8">
          <AuthForm />
        </div>
      </div>
    </main>
  );
}
