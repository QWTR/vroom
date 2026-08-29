import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ConvoyCodeRedirect() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  return <Redirect href={{ pathname: '/convoy', params: { code: String(code || '').toUpperCase() } } as any} />;
}
