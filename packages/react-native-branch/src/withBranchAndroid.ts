import {
  AndroidConfig,
  WarningAggregator,
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
} from "@expo/config-plugins";
import type {
  ConfigPlugin,
  ExportedConfigWithProps,
} from "@expo/config-plugins";
import {
  createGeneratedHeaderComment,
  mergeContents,
  removeGeneratedContents,
} from "@expo/config-plugins/build/utils/generateCode";
import type { MergeResults } from "@expo/config-plugins/build/utils/generateCode";
import fs from "fs";
import path from "path";
import assert from "assert";

async function readFileAsync(path: string) {
  return fs.promises.readFile(path, "utf8");
}

async function saveFileAsync(path: string, content: string) {
  return fs.promises.writeFile(path, content, "utf8");
}

// Fork of config-plugins mergeContents, but appends the contents to the end of the file.
function appendContents({
  src,
  newSrc,
  tag,
  comment,
}: {
  src: string;
  newSrc: string;
  tag: string;
  comment: string;
}): MergeResults {
  const header = createGeneratedHeaderComment(newSrc, tag, comment);
  if (!src.includes(header)) {
    // Ensure the old generated contents are removed.
    const sanitizedTarget = removeGeneratedContents(src, tag);
    const contentsToAdd = [
      // @something
      header,
      // contents
      newSrc,
      // @end
      `${comment} @generated end ${tag}`,
    ].join("\n");

    return {
      contents: (sanitizedTarget ?? src) + contentsToAdd,
      didMerge: true,
      didClear: !!sanitizedTarget,
    };
  }

  return { contents: src, didClear: false, didMerge: false };
}

export async function editMainApplication(
  config: ExportedConfigWithProps,
  action: (mainApplication: string) => string
) {
  const packageName = config.android?.package;
  assert(packageName, "android.package must be defined");

  const mainApplicationPath = path.join(
    config.modRequest.platformProjectRoot,
    "app",
    "src",
    "main",
    "java",
    ...packageName.split("."),
    "MainApplication.java"
  );

  try {
    const mainApplication = action(await readFileAsync(mainApplicationPath));
    return await saveFileAsync(mainApplicationPath, mainApplication);
  } catch (e) {
    WarningAggregator.addWarningAndroid(
      "rn-branch-plugin",
      `Couldn't modify MainApplication.java - ${e}.`
    );
  }
}

export async function editProguardRules(
  config: ExportedConfigWithProps,
  action: (mainApplication: string) => string
) {
  const proguardRulesPath = path.join(
    config.modRequest.platformProjectRoot,
    "app",
    "proguard-rules.pro"
  );
  try {
    const proguardRules = action(await readFileAsync(proguardRulesPath));
    return await saveFileAsync(proguardRulesPath, proguardRules);
  } catch (e) {
    WarningAggregator.addWarningAndroid(
      "rn-branch-plugin",
      `Couldn't modify proguard-rules.pro - ${e}.`
    );
  }
}

export function addBranchMainApplicationImport(
  src: string,
  packageId: string
): MergeResults {
  const newSrc = ["import io.branch.rnbranch.RNBranchModule;"];

  return mergeContents({
    tag: "rn-branch-import",
    src,
    newSrc: newSrc.join("\n"),
    anchor: `package ${packageId};`,
    offset: 1,
    comment: "//",
  });
}

export function addBranchGetAutoInstance(src: string): MergeResults {
  const newSrc = ["    RNBranchModule.getAutoInstance(this);"];

  return mergeContents({
    tag: "rn-branch-auto-instance",
    src,
    newSrc: newSrc.join("\n"),
    anchor: /super\.onCreate\(\);/,
    offset: 1,
    comment: "//",
  });
}

export function addBranchMainActivityImport(
  src: string,
  packageId: string
): MergeResults {
  const newSrc = [
    "import android.content.Intent;",
    "import io.branch.rnbranch.*;",
  ];

  return mergeContents({
    tag: "rn-branch-import",
    src,
    newSrc: newSrc.join("\n"),
    anchor: `package ${packageId};`,
    offset: 1,
    comment: "//",
  });
}

export function addBranchInitSession(src: string): MergeResults {
  const tag = "rn-branch-init-session";

  try {
    const newSrc = [
      "    RNBranchModule.initSession(getIntent().getData(), this);",
    ];

    return mergeContents({
      tag,
      src,
      newSrc: newSrc.join("\n"),
      anchor: /super\.onStart\(\);/,
      offset: 1,
      comment: "//",
    });
  } catch (err) {
    if (err.code !== "ERR_NO_MATCH") {
      throw err;
    }
  }

  const newSrc = [
    "  @Override",
    "  protected void onStart() {",
    "    super.onStart();",
    "    RNBranchModule.initSession(getIntent().getData(), this);",
    "  }",
  ];
  return mergeContents({
    tag,
    src,
    newSrc: newSrc.join("\n"),
    anchor: `getMainComponentName`,
    offset: 3,
    comment: "//",
  });
}

export function addBranchOnNewIntent(src: string): MergeResults {
  const tag = "rn-branch-on-new-intent";

  try {
    const newSrc = ["    RNBranchModule.onNewIntent(intent);"];

    return mergeContents({
      tag,
      src,
      newSrc: newSrc.join("\n"),
      anchor: /super\.onNewIntent\(intent\);/,
      offset: 1,
      comment: "//",
    });
  } catch (err) {
    if (err.code !== "ERR_NO_MATCH") {
      throw err;
    }
  }

  const newSrc = [
    "  @Override",
    "  public void onNewIntent(Intent intent) {",
    "    super.onNewIntent(intent);",
    "    RNBranchModule.onNewIntent(intent);",
    "  }",
  ];
  return mergeContents({
    tag,
    src,
    newSrc: newSrc.join("\n"),
    anchor: `getMainComponentName`,
    offset: 3,
    comment: "//",
  });
}

const { addMetaDataItemToMainApplication, getMainApplicationOrThrow } =
  AndroidConfig.Manifest;

// Splitting this function out of the mod makes it easier to test.
export async function setCustomConfigAsync(
  config: ExportedConfigWithProps<AndroidConfig.Manifest.AndroidManifest>,
  androidManifest: AndroidConfig.Manifest.AndroidManifest,
  branchApiKey: string
) {
  // Get the <application /> tag and assert if it doesn't exist.
  const mainApplication = getMainApplicationOrThrow(androidManifest);

  addMetaDataItemToMainApplication(
    mainApplication,
    // value for `android:name`
    "io.branch.sdk.BranchKey",
    // value for `android:value`
    branchApiKey
  );

  return androidManifest;
}

export const withBranchAndroid: ConfigPlugin<{ apiKey: string }> = (
  config,
  data
) => {
  // Insert the branch_key into the AndroidManifest
  config = withAndroidManifest(config, async (config) => {
    // Modifiers can be async, but try to keep them fast.
    config.modResults = await setCustomConfigAsync(
      config,
      config.modResults,
      data.apiKey
    );
    return config;
  });

  // Directly edit MainApplication.java
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const packageName = config.android?.package;
      assert(packageName, "android.package must be defined");

      await editMainApplication(config, (mainApplication) => {
        mainApplication = addBranchMainApplicationImport(
          mainApplication,
          packageName
        ).contents;
        mainApplication = addBranchGetAutoInstance(mainApplication).contents;

        return mainApplication;
      });

      return config;
    },
  ]);

  // Update proguard rules directly
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      await editProguardRules(config, (proguardRules) => {
        return appendContents({
          tag: "rn-branch-dont-warn",
          src: proguardRules,
          newSrc: ["-dontwarn io.branch.**"].join("\n"),
          comment: "#",
        }).contents;
      });

      return config;
    },
  ]);

  // Insert the required Branch code into MainActivity.java
  config = withMainActivity(config, (config) => {
    const packageName = config.android?.package;
    assert(packageName, "android.package must be defined");

    config.modResults.contents = addBranchMainActivityImport(
      config.modResults.contents,
      packageName
    ).contents;
    config.modResults.contents = addBranchInitSession(
      config.modResults.contents
    ).contents;
    config.modResults.contents = addBranchOnNewIntent(
      config.modResults.contents
    ).contents;

    return config;
  });

  return config;
};
