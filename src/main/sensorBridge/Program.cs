using System.Text.Json;
using LibreHardwareMonitor.Hardware;

var readings = new List<SensorReading>();

try
{
    var computer = new Computer
    {
        IsCpuEnabled = true,
        IsGpuEnabled = true,
        IsMemoryEnabled = true,
        IsMotherboardEnabled = true,
        IsControllerEnabled = true,
        IsStorageEnabled = true
    };

    computer.Open();

    foreach (var hardware in computer.Hardware)
    {
        VisitHardware(hardware, readings);
    }

    computer.Close();
}
catch (Exception error)
{
    Console.Error.WriteLine(error.Message);
}

Console.WriteLine(JsonSerializer.Serialize(readings, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));

static void VisitHardware(IHardware hardware, List<SensorReading> readings)
{
    hardware.Update();

    foreach (var subHardware in hardware.SubHardware)
    {
        VisitHardware(subHardware, readings);
    }

    foreach (var sensor in hardware.Sensors)
    {
        if (!sensor.Value.HasValue || float.IsNaN(sensor.Value.Value) || float.IsInfinity(sensor.Value.Value))
        {
            continue;
        }

        readings.Add(new SensorReading(
            hardware.Name,
            hardware.HardwareType.ToString(),
            sensor.Name,
            sensor.SensorType.ToString(),
            sensor.Value.Value,
            sensor.Identifier.ToString()
        ));
    }
}

internal sealed record SensorReading(
    string Hardware,
    string HardwareType,
    string Name,
    string Type,
    float Value,
    string Id
);
