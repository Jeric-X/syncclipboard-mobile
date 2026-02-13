/**
 * App Navigation
 */

import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet, StatusBar } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { HomeScreen } from '@/screens/HomeScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

// Placeholder screens
const HistoryScreen = () => {
  const { theme } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.text, { color: theme.colors.text }]}>历史记录</Text>
      <Text style={[styles.subtext, { color: theme.colors.textSecondary }]}>查看剪贴板历史</Text>
    </View>
  );
};

export const AppNavigator = () => {
  const { theme } = useTheme();

  // 创建适应主题的导航主题
  const navigationTheme = theme.isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: theme.colors.primary,
          background: theme.colors.background,
          card: theme.colors.surface,
          text: theme.colors.text,
          border: theme.colors.border,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          primary: theme.colors.primary,
          background: theme.colors.background,
          card: theme.colors.surface,
          text: theme.colors.text,
          border: theme.colors.border,
        },
      };

  return (
    <>
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.surface}
      />
      <NavigationContainer theme={navigationTheme}>
        <Tab.Navigator
          screenOptions={{
            headerStyle: {
              backgroundColor: theme.colors.surface,
            },
            headerTintColor: theme.colors.text,
            headerTitleStyle: {
              fontWeight: 'bold',
            },
            tabBarStyle: {
              backgroundColor: theme.colors.tabBarBackground,
              borderTopColor: theme.colors.tabBarBorder,
            },
            tabBarActiveTintColor: theme.colors.tabBarActive,
            tabBarInactiveTintColor: theme.colors.tabBarInactive,
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: '首页' }} />
          <Tab.Screen name="History" component={HistoryScreen} options={{ title: '历史' }} />
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: '设置' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtext: {
    fontSize: 16,
  },
});
