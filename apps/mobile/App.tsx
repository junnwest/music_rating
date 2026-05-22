import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>sillajuku</Text>
      <Text style={styles.sub}>Every record you've loved.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontSize: 40,
    fontWeight: '800',
    color: '#1A1A18',
    letterSpacing: -1.5,
    marginBottom: 8,
  },
  sub: {
    fontSize: 16,
    color: '#8C8C8A',
    fontWeight: '500',
  },
});
