import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Consistent top-of-screen title bar used across the main tabs.
 * Keeps title typography identical everywhere; `right` renders an optional
 * trailing control (filter pill, icon row, etc.). Pass `borderless` for
 * screens whose content sits flush under the title (e.g. Search).
 */
export function ScreenHeader({
  title,
  right,
  borderless = false,
}: {
  title: string;
  right?: ReactNode;
  borderless?: boolean;
}) {
  return (
    <View style={[styles.header, borderless && styles.headerBorderless]}>
      <Text style={styles.title}>{title}</Text>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#F8F8F6',
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E6',
  },
  headerBorderless: {
    borderBottomWidth: 0,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A1A18',
    letterSpacing: -0.6,
  },
});
