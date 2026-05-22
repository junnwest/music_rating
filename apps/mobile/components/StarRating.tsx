import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const AMBER = '#D97706';
const EMPTY = '#E8E8E6';

interface StarRatingProps {
  value: number | null;
  onChange: (score: number) => void;
  size?: number;
  readonly?: boolean;
}

export default function StarRating({ value, onChange, size = 28, readonly = false }: StarRatingProps) {
  const filled = value ?? 0;

  function getIconName(starIndex: number): 'star' | 'star-half' | 'star-outline' {
    const threshold = starIndex + 1;
    if (filled >= threshold) return 'star';
    if (filled >= threshold - 0.5) return 'star-half';
    return 'star-outline';
  }

  function getColor(starIndex: number): string {
    const iconName = getIconName(starIndex);
    return iconName === 'star-outline' ? EMPTY : AMBER;
  }

  return (
    <View style={styles.row}>
      {[0, 1, 2, 3, 4].map((i) => {
        const iconName = getIconName(i);
        const color = getColor(i);

        if (readonly) {
          return (
            <View key={i} style={{ marginHorizontal: 1 }}>
              <Ionicons name={iconName} size={size} color={color} />
            </View>
          );
        }

        return (
          <View key={i} style={{ marginHorizontal: 1, width: size, height: size }}>
            <Ionicons name={iconName} size={size} color={color} />
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              <Pressable
                style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%' }}
                onPress={() => onChange(i + 0.5)}
                hitSlop={2}
              />
              <Pressable
                style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%' }}
                onPress={() => onChange(i + 1)}
                hitSlop={2}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
