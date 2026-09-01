import {
  addGoogleServicesClasspath,
  applyGoogleServicesPlugin,
} from '../../plugins/withOptionalFirebaseMessaging';

describe('optional Firebase Messaging config plugin', () => {
  it('adds the Google services classpath once', () => {
    const projectBuildGradle = `buildscript {
  dependencies {
    classpath('com.android.tools.build:gradle:8.0.0')
  }
}`;

    const configured = addGoogleServicesClasspath(projectBuildGradle);

    expect(configured).toContain("classpath('com.google.gms:google-services:4.5.0')");
    expect(addGoogleServicesClasspath(configured)).toBe(configured);
  });

  it('applies the Google services plugin once', () => {
    const appBuildGradle = "apply plugin: 'com.android.application'\n";

    const configured = applyGoogleServicesPlugin(appBuildGradle);

    expect(configured).toContain("apply plugin: 'com.google.gms.google-services'");
    expect(applyGoogleServicesPlugin(configured)).toBe(configured);
  });
});
