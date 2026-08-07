"""
Custom Keras -> TF.js LayersModel exporter.

Why this exists instead of the official `tensorflowjs` converter CLI: that converter
unconditionally imports `tensorflow_decision_forests` at module load time (even for a plain
Keras model with no decision-forest content), and that package has no Windows wheels. Rather
than route around it with WSL/Docker for a training pipeline that's supposed to be
reproducible on whatever machine someone has, this writes the same output format directly.

The format is small and stable: `model.json` is `{format, generatedBy, convertedBy,
modelTopology, weightsManifest}` where modelTopology is a standard Keras-2-style
`model.to_json()` payload, and weightsManifest lists each weight's tfjs-style name
("<layer_name>/kernel", "<layer_name>/bias") with shape/dtype, backed by a raw float32 buffer
in a companion .bin file. Verified against the current public/model/model.json (produced by the
real converter for #19's model) to confirm the shapes match exactly.

Keras-3-vs-2 note: TensorFlow 2.16+'s `tensorflow.keras` is Keras 3 by default, whose
`to_json()` output tf.js's LayersModel loader does not understand. `tf_keras` (installed
alongside `tensorflow`) is the standalone legacy Keras 2 API kept around for exactly this kind
of compatibility - the official converter depends on it too. So this module rebuilds an
identical-architecture twin in `tf_keras`, copies the trained weights across, and serializes
*that* twin's topology.
"""
import json
import os

import numpy as np
import tf_keras


def _twin_conv_block(x, filters, name_prefix, tf_keras_layers):
    x = tf_keras_layers.Conv2D(filters, 3, activation="relu", padding="same", name=f"{name_prefix}")(x)
    return x


def build_inference_twin(img_size: int, num_classes: int) -> tf_keras.Model:
    """Must exactly mirror train.py's build_model() inference path (post-augmentation-strip)."""
    layers = tf_keras.layers
    inputs = tf_keras.Input(shape=(img_size, img_size, 1), name="input_1")
    x = layers.Conv2D(24, 3, activation="relu", padding="same", name="conv2d")(inputs)
    x = layers.Conv2D(24, 3, activation="relu", padding="same", name="conv2d_1")(x)
    x = layers.MaxPooling2D(name="max_pooling2d")(x)
    x = layers.Conv2D(48, 3, activation="relu", padding="same", name="conv2d_2")(x)
    x = layers.MaxPooling2D(name="max_pooling2d_1")(x)
    x = layers.Conv2D(64, 3, activation="relu", padding="same", name="conv2d_3")(x)
    x = layers.MaxPooling2D(name="max_pooling2d_2")(x)
    x = layers.Flatten(name="flatten")(x)
    x = layers.Dense(128, activation="relu", name="dense")(x)
    x = layers.Dropout(0.3, name="dropout")(x)
    outputs = layers.Dense(num_classes, activation="softmax", name="dense_1")(x)
    return tf_keras.Model(inputs, outputs, name="doodlebot_classifier")


def export(weights_by_layer: dict, img_size: int, num_classes: int, out_dir: str) -> int:
    """weights_by_layer: {layer_name: [kernel_array, bias_array]}, from the trained Keras-3
    model (layer.get_weights()). Returns the total exported size in bytes."""
    twin = build_inference_twin(img_size, num_classes)
    for layer in twin.layers:
        if layer.name in weights_by_layer:
            layer.set_weights(weights_by_layer[layer.name])

    os.makedirs(out_dir, exist_ok=True)

    topology = json.loads(twin.to_json())

    weight_specs = []
    buffers = []
    for w in twin.weights:
        name = w.name.split(":")[0]  # "conv2d/kernel:0" -> "conv2d/kernel"
        arr = np.asarray(w.numpy() if hasattr(w, "numpy") else w, dtype=np.float32)
        weight_specs.append({"name": name, "shape": list(arr.shape), "dtype": "float32"})
        buffers.append(arr.tobytes())

    weights_filename = "group1-shard1of1.bin"
    with open(os.path.join(out_dir, weights_filename), "wb") as f:
        for buf in buffers:
            f.write(buf)

    model_json = {
        "format": "layers-model",
        "generatedBy": f"keras v{tf_keras.__version__}",
        "convertedBy": "training/export_tfjs.py (custom, see module docstring)",
        "modelTopology": {
            "keras_version": tf_keras.__version__,
            "backend": "tensorflow",
            "model_config": topology,
            "training_config": None,
        },
        "weightsManifest": [{"paths": [weights_filename], "weights": weight_specs}],
    }
    with open(os.path.join(out_dir, "model.json"), "w") as f:
        json.dump(model_json, f)

    total_bytes = os.path.getsize(os.path.join(out_dir, weights_filename))
    total_bytes += os.path.getsize(os.path.join(out_dir, "model.json"))
    return total_bytes
